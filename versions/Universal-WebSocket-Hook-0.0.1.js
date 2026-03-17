// ==UserScript==
// @name         Universal WebSocket Hook
// @namespace    https://tampermonkey.net/
// @version      0.0.1
// @description  try to take over the world!
// @author       razoshi
// @match        *://*/*
// @run-at       document-start
// @icon         https://web-creator.ru/technologies/websockets.png
// @grant        none
// @allIframes   true
// @license      MIT
// ==/UserScript==

new Proxy(window, {
    set: (_, prop, val) => {
        window[prop] = val;
        return true;
    },
    deleteProperty: (_, prop) => {
        delete window[prop]; return true;
    }
});
window.log = console.log;
console.info = console.log = () => {};
const {
    log
} = window;

(function() {
    "use strict";
    const _Function = Function;
    const _Proxy = Proxy;
    const _apply = Reflect.apply;
    const _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const _defineProperty = Object.defineProperty;
    const scopeList = new WeakSet();

    function decodePacket(data) {
        if (typeof data === "string") {
            try {
                return JSON.parse(data);
            } catch {
                return data;
            }
        }
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            return new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer, data.byteOffset ?? 0, data.byteLength);
        }
        return data;
    }

    function hookWindow(win) {
        if (!win || scopeList.has(win)) return;
        scopeList.add(win);

        const wsProto = win.WebSocket.prototype;

        const originalSend = wsProto.send;
        wsProto.send = new Proxy(originalSend, {
            apply(target, thisArg, args) {
                const data = args[0];
                const decoded = decodePacket(data);
                console.group(`client -> server`);
                log(`raw:`, (data instanceof ArrayBuffer || data instanceof Uint8Array) ? new Uint8Array(data) : data);
                log(`decoded:`, decoded);
                console.groupEnd();
                return _apply(target, thisArg, args);
            }
        });

        const msgDesc = _getOwnPropertyDescriptor(wsProto, 'onmessage');
        if (msgDesc && msgDesc.set) {
            _defineProperty(wsProto, 'onmessage', {
                set(handler) {
                    const wrappedHandler = new Proxy(handler, {
                        apply(target, thisArg, args) {
                            const event = args[0];
                            const decoded = decodePacket(event.data);
                            console.group(`server -> client`);
                            log(`raw:`, (event.data instanceof ArrayBuffer) ? new Uint8Array(event.data) : event.data);
                            log(`decoded:`, decoded);
                            console.groupEnd();
                            return _apply(target, thisArg, args);
                        }
                    });
                    return msgDesc.set.call(this, wrappedHandler);
                },
                get() {
                    return msgDesc.get.call(this);
                },
                configurable: true
            });
        }

        const originalAddEventListener = wsProto.addEventListener;
        wsProto.addEventListener = new Proxy(originalAddEventListener, {
            apply(target, thisArg, args) {
                const [type, listener, options] = args;
                if (type === 'message' && typeof listener === 'function') {
                    const wrappedListener = function(event) {
                        const decoded = decodePacket(event.data);
                        console.group(`server -> client (via listener)`);
                        log(`raw:`, (event.data instanceof ArrayBuffer) ? new Uint8Array(event.data) : event.data);
                        log(`decoded:`, decoded);
                        console.groupEnd();
                        return listener.apply(this, arguments);
                    };
                    return _apply(target, thisArg, [type, wrappedListener, options]);
                }
                return _apply(target, thisArg, args);
            }
        });

        const toStringOld = win.Function.prototype.toString;
        win.Function.prototype.toString = new Proxy(toStringOld, {
            apply(target, thisArg, args) {
                if (thisArg === wsProto.send) return toStringOld.call(originalSend);
                if (thisArg === wsProto.addEventListener) return toStringOld.call(originalAddEventListener);
                return _apply(target, thisArg, args);
            }
        });

        log(`attached to window`);
    }

    function getScope(scope) {
        if (!scope) return;
        try {
            hookWindow(scope);

            const _createElement = scope.document.createElement;
            scope.document.createElement = new Proxy(_createElement, {
                apply(target, thisArg, args) {
                    const el = _apply(target, thisArg, args);
                    if (args[0] && typeof args[0] === 'string' && args[0].toLowerCase() === "iframe") {
                        const hookIframe = () => {
                            try {
                                if (el.contentWindow) {
                                    getScope(el.contentWindow);
                                }
                            } catch(e) {}
                        };
                        el.addEventListener('load', hookIframe);

                        try {
                            const contentWindowDesc = _getOwnPropertyDescriptor(scope.HTMLIFrameElement.prototype, 'contentWindow');
                            if(contentWindowDesc) {
                                _defineProperty(el, 'contentWindow', {
                                    get() {
                                        const win = contentWindowDesc.get.call(this);
                                        if(win) getScope(win);
                                        return win;
                                    },
                                    configurable: true
                                });
                            }
                        } catch (e) {
                        }
                    }
                    return el;
                }
            });
        } catch (e) {
        }
    }
    getScope(window);
})();