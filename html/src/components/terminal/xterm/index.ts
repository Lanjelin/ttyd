import type { IDisposable, ITerminalOptions } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { OverlayAddon } from './addons/overlay';
import { ZmodemAddon } from './addons/zmodem';

import '@xterm/xterm/css/xterm.css';

interface TtydTerminal extends Terminal {
    fit(): void;
}

declare global {
    interface Window {
        term: TtydTerminal;
    }
}

enum Command {
    // server side
    OUTPUT = '0',
    SET_WINDOW_TITLE = '1',
    SET_PREFERENCES = '2',

    // client side
    INPUT = '0',
    RESIZE_TERMINAL = '1',
    PAUSE = '2',
    RESUME = '3',
}
type Preferences = ITerminalOptions & ClientOptions;

export type RendererType = 'dom' | 'webgl';

export interface ClientOptions {
    rendererType: RendererType;
    disableLeaveAlert: boolean;
    disableResizeOverlay: boolean;
    enableZmodem: boolean;
    enableTrzsz: boolean;
    enableSixel: boolean;
    titleFixed?: string;
    isWindows: boolean;
    trzszDragInitTimeout: number;
    unicodeVersion: string;
    closeOnDisconnect: boolean;
}

export interface FlowControl {
    limit: number;
    highWater: number;
    lowWater: number;
}

export interface XtermOptions {
    wsUrl: string;
    tokenUrl: string;
    flowControl: FlowControl;
    clientOptions: ClientOptions;
    termOptions: ITerminalOptions;
}

function toDisposable(f: () => void): IDisposable {
    return { dispose: f };
}

function addEventListener(target: EventTarget, type: string, listener: EventListener): IDisposable {
    target.addEventListener(type, listener);
    return toDisposable(() => target.removeEventListener(type, listener));
}

export class Xterm {
    private static nextFontId = 0;

    private disposables: IDisposable[] = [];
    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();
    private written = 0;
    private pending = 0;

    private terminal: Terminal;
    private fitAddon = new FitAddon();
    private overlayAddon = new OverlayAddon();
    private clipboardAddon = new ClipboardAddon();
    private webLinksAddon = new WebLinksAddon();
    private webglAddon?: WebglAddon;
    private zmodemAddon?: ZmodemAddon;

    private socket?: WebSocket;
    private token: string;
    private opened = false;
    private disposed = false;
    private tokenRequest = 0;
    private font?: FontFace;
    private fontUrl?: string;
    private fallbackFontFamily?: string;
    private title?: string;
    private titleFixed?: string;
    private resizeOverlay = true;
    private reconnect = true;
    private doReconnect = true;
    private closeOnDisconnect = false;

    private writeFunc = (data: ArrayBuffer) => this.writeData(new Uint8Array(data));

    constructor(
        private options: XtermOptions,
        private sendCb: () => void
    ) {}

    dispose() {
        this.disposed = true;
        this.disposeListeners();
        if (this.font) {
            document.fonts.delete(this.font);
            this.font = undefined;
        }
        this.fontUrl = undefined;
    }

    private disposeListeners() {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables.length = 0;
    }

    private register = <T extends IDisposable>(d: T): T => {
        this.disposables.push(d);
        return d;
    };

    public sendFile(files: FileList) {
        this.zmodemAddon?.sendFile(files);
    }

    public refreshToken = async () => {
        if (this.disposed) return;
        const request = ++this.tokenRequest;
        try {
            const resp = await fetch(this.options.tokenUrl);
            if (resp.ok) {
                const json = await resp.json();
                if (this.disposed || request !== this.tokenRequest) return;
                this.token = json.token;
                await this.loadFont(typeof json.font === 'string' && json.font !== '' ? json.font : undefined, request);
            }
        } catch (e) {
            if (!this.disposed && request === this.tokenRequest) {
                console.error(`[ttyd] fetch ${this.options.tokenUrl}: `, e);
            }
        }
    };

    private async loadFont(url: string | undefined, request: number) {
        if (url === this.fontUrl) return;

        let font: FontFace | undefined;
        if (url) {
            try {
                const face = new FontFace(`ttyd-custom-font-${++Xterm.nextFontId}`, `url(${JSON.stringify(url)})`);
                await face.load();
                if (this.disposed || request !== this.tokenRequest) return;
                document.fonts.add(face);
                font = face;
            } catch (e) {
                if (this.disposed || request !== this.tokenRequest) return;
                console.warn(`[ttyd] failed to load font ${url}; using fallback font`, e);
            }
        }

        if (this.font) document.fonts.delete(this.font);
        this.font = font;
        this.fontUrl = font ? url : undefined;
        if (this.terminal) {
            this.terminal.options.fontFamily = font?.family ?? this.fallbackFontFamily;
            this.fitAddon.fit();
        }
    }

    private onWindowUnload = (event: BeforeUnloadEvent) => {
        event.preventDefault();
        if (this.socket?.readyState === WebSocket.OPEN) {
            const message = 'Close terminal? this will also terminate the command.';
            event.returnValue = message;
            return message;
        }
        return undefined;
    };

    public open(parent: HTMLElement) {
        if (this.disposed) return;
        this.terminal = new Terminal(this.options.termOptions);
        this.fallbackFontFamily = this.terminal.options.fontFamily;
        if (this.font) this.terminal.options.fontFamily = this.font.family;
        const { terminal, fitAddon, overlayAddon, clipboardAddon, webLinksAddon } = this;
        window.term = terminal as TtydTerminal;
        window.term.fit = () => {
            this.fitAddon.fit();
        };

        terminal.loadAddon(fitAddon);
        terminal.loadAddon(overlayAddon);
        terminal.loadAddon(clipboardAddon);
        terminal.loadAddon(webLinksAddon);

        // xterm 6 no longer maps Alt+arrows to the previous word-motion sequences.
        const isMac = /Mac/.test(navigator.platform);
        terminal.attachCustomKeyEventHandler(event => {
            if (event.type !== 'keydown' || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return true;
            let data: string;
            switch (event.key) {
                case 'ArrowLeft':
                    data = isMac ? '\x1bb' : '\x1b[1;5D';
                    break;
                case 'ArrowRight':
                    data = isMac ? '\x1bf' : '\x1b[1;5C';
                    break;
                case 'ArrowUp':
                    if (isMac) return true;
                    data = '\x1b[1;5A';
                    break;
                case 'ArrowDown':
                    if (isMac) return true;
                    data = '\x1b[1;5B';
                    break;
                default:
                    return true;
            }
            if (!terminal.options.disableStdin) terminal.input(data, true);
            event.preventDefault();
            return false;
        });

        terminal.open(parent);
        this.updateBackground();
        fitAddon.fit();
    }

    private initListeners() {
        const { terminal, fitAddon, overlayAddon, register, sendData } = this;
        register(
            terminal.onTitleChange(data => {
                if (data && data !== '' && !this.titleFixed) {
                    document.title = data + ' | ' + this.title;
                }
            })
        );
        register(terminal.onData(data => sendData(data)));
        register(terminal.onBinary(data => sendData(Uint8Array.from(data, v => v.charCodeAt(0)))));
        register(
            terminal.onResize(({ cols, rows }) => {
                const msg = JSON.stringify({ columns: cols, rows: rows });
                this.socket?.send(this.textEncoder.encode(Command.RESIZE_TERMINAL + msg));
                if (this.resizeOverlay) overlayAddon.showOverlay(`${cols}x${rows}`, 300);
            })
        );
        register(
            terminal.onSelectionChange(() => {
                if (this.terminal.getSelection() === '') return;
                try {
                    document.execCommand('copy');
                } catch (e) {
                    return;
                }
                this.overlayAddon?.showOverlay('\u2702', 200);
            })
        );
        // Fit after layout and xterm's renderer/DPI measurements have settled.
        let fitFrame = 0;
        const scheduleFit = () => {
            if (fitFrame) return;
            fitFrame = requestAnimationFrame(() => {
                fitFrame = 0;
                fitAddon.fit();
            });
        };
        const observer = new ResizeObserver(scheduleFit);
        const element = terminal.element;
        if (element?.parentElement) observer.observe(element.parentElement);
        const screen = element?.querySelector('.xterm-screen');
        if (screen) observer.observe(screen);
        register(toDisposable(() => {
            observer.disconnect();
            cancelAnimationFrame(fitFrame);
        }));
        register(addEventListener(window, 'resize', scheduleFit));
        register(addEventListener(window, 'beforeunload', this.onWindowUnload));
    }

    public writeData = (data: string | Uint8Array) => {
        const { terminal, textEncoder } = this;
        const { limit, highWater, lowWater } = this.options.flowControl;

        this.written += data.length;
        if (this.written > limit) {
            terminal.write(data, () => {
                this.pending = Math.max(this.pending - 1, 0);
                if (this.pending < lowWater) {
                    this.socket?.send(textEncoder.encode(Command.RESUME));
                }
            });
            this.pending++;
            this.written = 0;
            if (this.pending > highWater) {
                this.socket?.send(textEncoder.encode(Command.PAUSE));
            }
        } else {
            terminal.write(data);
        }
    };

    public sendData = (data: string | Uint8Array) => {
        const { socket, textEncoder } = this;
        if (socket?.readyState !== WebSocket.OPEN) return;

        if (typeof data === 'string') {
            const payload = new Uint8Array(data.length * 3 + 1);
            payload[0] = Command.INPUT.charCodeAt(0);
            const stats = textEncoder.encodeInto(data, payload.subarray(1));
            socket.send(payload.subarray(0, (stats.written as number) + 1));
        } else {
            const payload = new Uint8Array(data.length + 1);
            payload[0] = Command.INPUT.charCodeAt(0);
            payload.set(data, 1);
            socket.send(payload);
        }
    };

    public connect = () => {
        if (this.disposed) return;
        this.socket = new WebSocket(this.options.wsUrl, ['tty']);
        const { socket, register } = this;

        socket.binaryType = 'arraybuffer';
        register(addEventListener(socket, 'open', this.onSocketOpen));
        register(addEventListener(socket, 'message', this.onSocketData as EventListener));
        register(addEventListener(socket, 'close', this.onSocketClose as EventListener));
        register(addEventListener(socket, 'error', () => (this.doReconnect = false)));
    };

    private onSocketOpen = () => {
        console.log('[ttyd] websocket connection opened');

        const { textEncoder, terminal, overlayAddon } = this;
        const msg = JSON.stringify({ AuthToken: this.token, columns: terminal.cols, rows: terminal.rows });
        this.socket?.send(textEncoder.encode(msg));

        if (this.opened) {
            terminal.reset();
            terminal.options.disableStdin = false;
            overlayAddon.showOverlay('Reconnected', 300);
        } else {
            this.opened = true;
        }

        this.doReconnect = this.reconnect;
        this.initListeners();
        terminal.focus();
    };

    private onSocketClose = (event: CloseEvent) => {
        console.log(`[ttyd] websocket connection closed with code: ${event.code}`);

        const { refreshToken, connect, doReconnect, overlayAddon } = this;
        overlayAddon.showOverlay('Connection Closed');
        this.disposeListeners();

        // 1000: CLOSE_NORMAL
        if (event.code !== 1000 && doReconnect) {
            overlayAddon.showOverlay('Reconnecting...');
            refreshToken().then(connect);
        } else if (this.closeOnDisconnect) {
            window.close();
        } else {
            const { terminal } = this;
            const keyDispose = this.register(terminal.onKey(e => {
                const event = e.domEvent;
                if (event.key === 'Enter') {
                    keyDispose.dispose();
                    overlayAddon.showOverlay('Reconnecting...');
                    refreshToken().then(connect);
                }
            }));
            overlayAddon.showOverlay('Press ⏎ to Reconnect');
        }
    };

    private parseOptsFromUrlQuery(query: string): Preferences {
        const { terminal } = this;
        const { clientOptions } = this.options;
        const prefs = {} as Preferences;
        const queryObj = Array.from(new URLSearchParams(query) as unknown as Iterable<[string, string]>);

        for (const [k, queryVal] of queryObj) {
            let v = clientOptions[k];
            if (v === undefined) v = terminal.options[k];
            switch (typeof v) {
                case 'boolean':
                    prefs[k] = queryVal === 'true' || queryVal === '1';
                    break;
                case 'number':
                case 'bigint':
                    prefs[k] = Number.parseInt(queryVal, 10);
                    break;
                case 'string':
                    prefs[k] = queryVal;
                    break;
                case 'object':
                    prefs[k] = JSON.parse(queryVal);
                    break;
                default:
                    console.warn(`[ttyd] maybe unknown option: ${k}=${queryVal}, treating as string`);
                    prefs[k] = queryVal;
                    break;
            }
        }

        return prefs;
    }

    private onSocketData = (event: MessageEvent) => {
        const { textDecoder } = this;
        const rawData = event.data as ArrayBuffer;
        const cmd = String.fromCharCode(new Uint8Array(rawData)[0]);
        const data = rawData.slice(1);

        switch (cmd) {
            case Command.OUTPUT:
                this.writeFunc(data);
                break;
            case Command.SET_WINDOW_TITLE:
                this.title = textDecoder.decode(data);
                document.title = this.title;
                break;
            case Command.SET_PREFERENCES:
                this.applyPreferences({
                    ...this.options.clientOptions,
                    ...JSON.parse(textDecoder.decode(data)),
                    ...this.parseOptsFromUrlQuery(window.location.search),
                } as Preferences);
                break;
            default:
                console.warn(`[ttyd] unknown command: ${cmd}`);
                break;
        }
    };

    private applyPreferences(prefs: Preferences) {
        const { terminal, fitAddon, register } = this;
        if (prefs.enableZmodem || prefs.enableTrzsz) {
            this.zmodemAddon = new ZmodemAddon({
                zmodem: prefs.enableZmodem,
                trzsz: prefs.enableTrzsz,
                windows: prefs.isWindows,
                trzszDragInitTimeout: prefs.trzszDragInitTimeout,
                onSend: this.sendCb,
                sender: this.sendData,
                writer: this.writeData,
            });
            this.writeFunc = data => this.zmodemAddon?.consume(data);
            terminal.loadAddon(register(this.zmodemAddon));
        }

        for (const [key, value] of Object.entries(prefs)) {
            switch (key) {
                case 'fontFamily':
                    this.fallbackFontFamily = value;
                    if (!this.font) terminal.options.fontFamily = value;
                    break;
                case 'rendererType':
                    this.setRendererType(value);
                    break;
                case 'disableLeaveAlert':
                    if (value) {
                        window.removeEventListener('beforeunload', this.onWindowUnload);
                        console.log('[ttyd] Leave site alert disabled');
                    }
                    break;
                case 'disableResizeOverlay':
                    if (value) {
                        console.log('[ttyd] Resize overlay disabled');
                        this.resizeOverlay = false;
                    }
                    break;
                case 'disableReconnect':
                    if (value) {
                        console.log('[ttyd] Reconnect disabled');
                        this.reconnect = false;
                        this.doReconnect = false;
                    }
                    break;
                case 'enableZmodem':
                    if (value) console.log('[ttyd] Zmodem enabled');
                    break;
                case 'enableTrzsz':
                    if (value) console.log('[ttyd] trzsz enabled');
                    break;
                case 'trzszDragInitTimeout':
                    if (value) console.log(`[ttyd] trzsz drag init timeout: ${value}`);
                    break;
                case 'enableSixel':
                    if (value) {
                        terminal.loadAddon(register(new ImageAddon()));
                        console.log('[ttyd] Sixel enabled');
                    }
                    break;
                case 'closeOnDisconnect':
                    if (value) {
                        console.log('[ttyd] close on disconnect enabled (Reconnect disabled)');
                        this.closeOnDisconnect = true;
                        this.reconnect = false;
                        this.doReconnect = false;
                    }
                    break;
                case 'titleFixed':
                    if (!value || value === '') return;
                    console.log(`[ttyd] setting fixed title: ${value}`);
                    this.titleFixed = value;
                    document.title = value;
                    break;
                case 'isWindows':
                    if (value) console.log('[ttyd] is windows');
                    break;
                case 'unicodeVersion':
                    switch (value) {
                        case 6:
                        case '6':
                            console.log('[ttyd] setting Unicode version: 6');
                            break;
                        case 11:
                        case '11':
                        default:
                            console.log('[ttyd] setting Unicode version: 11');
                            terminal.loadAddon(new Unicode11Addon());
                            terminal.unicode.activeVersion = '11';
                            break;
                    }
                    break;
                default:
                    console.log(`[ttyd] option: ${key}=${JSON.stringify(value)}`);
                    if (terminal.options[key] instanceof Object) {
                        terminal.options[key] = Object.assign({}, terminal.options[key], value);
                    } else {
                        terminal.options[key] = value;
                    }
                    break;
            }
        }
        this.updateBackground();
        fitAddon.fit();
    }

    private updateBackground() {
        document.documentElement.style.setProperty(
            '--terminal-background',
            this.terminal.options.theme?.background ?? '#000000'
        );
    }

    private setRendererType(value: RendererType) {
        const disposeWebglRenderer = () => {
            this.webglAddon?.dispose();
            this.webglAddon = undefined;
            this.fitAddon.fit();
        };

        if (value === 'webgl') {
            if (this.webglAddon) return;
            try {
                const addon = new WebglAddon();
                this.webglAddon = addon;
                addon.onContextLoss(() => {
                    console.warn('[ttyd] WebGL context lost, falling back to DOM renderer');
                    disposeWebglRenderer();
                });
                this.terminal.loadAddon(addon);
                this.fitAddon.fit();
                console.log('[ttyd] WebGL renderer loaded');
                return;
            } catch (e) {
                console.warn('[ttyd] WebGL renderer could not be loaded, falling back to DOM renderer', e);
            }
        } else if (value !== 'dom') {
            console.warn(`[ttyd] unsupported renderer: ${value}, falling back to DOM renderer`);
        }

        disposeWebglRenderer();
        console.log('[ttyd] DOM renderer loaded');
    }
}
