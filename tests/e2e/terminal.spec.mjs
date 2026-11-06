import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { startServer } from '../helpers/server.mjs';

const pollOptions = { timeout: 10_000 };

async function fixtureLog(server) {
    try {
        return await readFile(server.eventsPath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
    }
}

async function fixtureEvents(server) {
    // Ignore a final, partially written JSONL record until its newline arrives.
    return (await fixtureLog(server)).split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line));
}

function inputData(events) {
    return events.filter(event => event.type === 'input').map(event => event.data).join('');
}

async function terminalText(page) {
    return page.evaluate(() => {
        const buffer = window.term?.buffer.active;
        if (!buffer) return '';
        const lines = [];
        for (let row = 0; row < buffer.length; row++) {
            lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
        }
        return lines.join('\n');
    });
}

async function terminalSize(page) {
    return page.evaluate(() => ({ rows: window.term.rows, cols: window.term.cols }));
}

async function sendCommand(page, command) {
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(command);
    await page.keyboard.press('Enter');
}

async function readyTerminal(page, server) {
    await expect.poll(() => terminalText(page), pollOptions).toContain('READY');
    await expect.poll(async () => (await fixtureEvents(server)).filter(event => event.type === 'ready'), pollOptions)
        .toHaveLength(1);
    return (await fixtureEvents(server)).find(event => event.type === 'ready');
}

async function openTerminal(page, server) {
    const response = await page.goto(server.url);
    expect(response?.status()).toBe(200);
    return readyTerminal(page, server);
}

async function echoRoundtrip(page, server, value) {
    const command = `echo ${value}`;
    await sendCommand(page, command);
    await expect.poll(() => terminalText(page), pollOptions).toContain(`ECHO:${value}`);
    await expect.poll(async () => inputData(await fixtureEvents(server)), pollOptions).toBe(`${command}\r`);
}

async function resizeTerminal(page, server, viewport) {
    const before = await terminalSize(page);
    const eventCount = (await fixtureEvents(server)).length;
    await page.setViewportSize(viewport);
    let dimensions;
    await expect.poll(async () => {
        const current = await terminalSize(page);
        if (current.rows === before.rows || current.cols === before.cols) return false;
        const resize = (await fixtureEvents(server)).slice(eventCount).filter(event => event.type === 'resize').at(-1);
        if (resize?.rows !== current.rows || resize?.cols !== current.cols) return false;
        dimensions = current;
        return true;
    }, { ...pollOptions, message: 'the child PTY receives the browser terminal dimensions' }).toBe(true);
    return dimensions;
}

function socketFor(sockets, server) {
    const socket = sockets.find(candidate => candidate.url === server.wsUrl);
    expect(socket, `browser WebSocket to ${server.wsUrl}`).toBeDefined();
    return socket;
}

async function withTerminal(page, testInfo, options, run) {
    const server = await startServer(options);
    const pageErrors = [];
    const consoleMessages = [];
    const sockets = [];
    const onPageError = error => pageErrors.push(error.stack ?? error.message);
    const onConsole = message => consoleMessages.push({ type: message.type(), text: message.text() });
    const onSocket = socket => {
        const trace = { url: socket.url(), events: [], closed: false };
        sockets.push(trace);
        for (const [eventName, type] of [['framesent', 'sent'], ['framereceived', 'received']]) {
            socket.on(eventName, ({ payload }) => {
                trace.events.push({ type, data: typeof payload === 'string' ? payload : payload.toString('utf8') });
            });
        }
        socket.on('close', () => {
            trace.events.push({ type: 'close' });
            trace.closed = true;
        });
        socket.on('socketerror', error => trace.events.push({ type: 'error', error: String(error) }));
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    page.on('websocket', onSocket);
    try {
        await run(server, { sockets, consoleMessages });
        expect(pageErrors, 'uncaught browser errors').toEqual([]);
    } finally {
        // stop() removes the fixture directory, so preserve its evidence first.
        try {
            await testInfo.attach('fixture-events.jsonl', {
                body: await fixtureLog(server),
                contentType: 'application/x-ndjson',
            });
        } finally {
            try {
                await server.stop();
            } finally {
                page.off('pageerror', onPageError);
                page.off('console', onConsole);
                page.off('websocket', onSocket);
                await testInfo.attach('ttyd.log', { body: server.logs(), contentType: 'text/plain' });
                await testInfo.attach('browser.json', {
                    body: JSON.stringify({ pageErrors, consoleMessages, sockets }, null, 2),
                    contentType: 'application/json',
                });
            }
        }
    }
}

test('embedded terminal sends real keyboard input to its PTY and renders the response', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, { args: ['-W'] }, async server => {
        const ready = await openTerminal(page, server);
        expect(ready.pid).toBeGreaterThan(0);
        expect(ready.rows).toBeGreaterThan(0);
        expect(ready.cols).toBeGreaterThan(0);
        await echoRoundtrip(page, server, 'keyboard-roundtrip');
    });
});

test('browser clipboard paste delivers a large input without reconnecting', async ({ page }, testInfo) => {
    // Playwright's WebSocket exposes frames but not negotiated extensions.
    // Observe native sockets without changing how the terminal constructs them.
    await page.addInitScript(() => {
        window.__pasteWebSockets = [];
        window.WebSocket = new Proxy(window.WebSocket, {
            construct(target, args, newTarget) {
                const socket = Reflect.construct(target, args, newTarget);
                const trace = { url: socket.url, extensions: null, closed: false };
                window.__pasteWebSockets.push(trace);
                socket.addEventListener('open', () => { trace.extensions = socket.extensions; });
                socket.addEventListener('close', () => { trace.closed = true; });
                return socket;
            },
        });
    });
    await withTerminal(page, testInfo, { args: ['-W'] }, async (server, { sockets }) => {
        await openTerminal(page, server);
        const socket = socketFor(sockets, server);
        // Repeated bytes compress to almost nothing and do not exercise a multi-chunk inflate;
        // deterministic pseudo-random base64 does.
        let state = 0x2545f491;
        const body = Buffer.from(Array.from({ length: 24 * 1024 }, () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return state >>> 24;
        })).toString('base64');
        const value = `paste-start-${body}-paste-end`;
        const command = `echo ${value}`;
        await page.locator('.xterm-helper-textarea').focus();
        await page.locator('.xterm-helper-textarea').evaluate((textarea, text) => {
            const clipboardData = new DataTransfer();
            clipboardData.setData('text/plain', text);
            textarea.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData,
                bubbles: true,
                cancelable: true,
            }));
        }, `${command}\n`);
        await expect.poll(async () => inputData(await fixtureEvents(server)), pollOptions).toBe(`${command}\r`);
        // The long echo wraps visually; remove row separators to compare every
        // response character, rather than merely finding a short end marker.
        await expect.poll(async () => (await terminalText(page)).replaceAll('\n', ''), pollOptions)
            .toBe(`READYECHO:${value}`);

        await sendCommand(page, 'echo after-paste');
        await expect.poll(async () => inputData(await fixtureEvents(server)), pollOptions)
            .toBe(`${command}\recho after-paste\r`);
        await expect.poll(async () => (await terminalText(page)).replaceAll('\n', ''), pollOptions)
            .toBe(`READYECHO:${value}ECHO:after-paste`);
        expect((await fixtureEvents(server)).filter(event => event.type === 'ready')).toHaveLength(1);
        expect((await fixtureEvents(server)).filter(event => event.type === 'exit')).toEqual([]);
        expect(sockets.map(candidate => candidate.url)).toEqual([server.wsUrl]);
        expect(socket.closed).toBe(false);
        expect(socket.events.filter(event => event.type === 'error')).toEqual([]);
        expect(page.isClosed()).toBe(false);
        expect(page.url()).toBe(server.url);

        const nativeSockets = await page.evaluate(() => window.__pasteWebSockets);
        expect(nativeSockets).toHaveLength(1);
        expect(nativeSockets[0]).toMatchObject({ url: server.wsUrl, closed: false });
        expect(nativeSockets[0].extensions).not.toBeNull();
        if (process.env.TTYD_REQUIRE_COMPRESSION === '1') {
            expect(nativeSockets[0].extensions.split(',').map(extension => extension.trim().split(';')[0]))
                .toContain('permessage-deflate');
        }
    });
});

test('read-only terminal renders output and drops input while still processing resize', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, {}, async (server, { sockets }) => {
        await page.setViewportSize({ width: 960, height: 640 });
        await openTerminal(page, server);
        const socket = socketFor(sockets, server);
        const command = 'echo readonly-must-not-run';
        await sendCommand(page, command);
        await expect.poll(() => socket.events
            .filter(event => event.type === 'sent' && event.data.startsWith('0'))
            .map(event => event.data.slice(1)).join(''), pollOptions).toBe(`${command}\r`);

        // This later message on the same socket is a processing barrier: the
        // fixture must observe SIGWINCH before absence of PTY input is asserted.
        await resizeTerminal(page, server, { width: 1320, height: 860 });
        expect((await fixtureEvents(server)).filter(event => event.type === 'input')).toEqual([]);
        expect(await terminalText(page)).toContain('READY');
        expect(await terminalText(page)).not.toContain('ECHO:readonly-must-not-run');
        expect(socket.closed).toBe(false);
    });
});

test('resizing the browser updates the child PTY to window.term rows and columns', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, { args: ['-W'] }, async server => {
        await page.setViewportSize({ width: 960, height: 640 });
        await openTerminal(page, server);
        const size = await resizeTerminal(page, server, { width: 1320, height: 860 });
        await sendCommand(page, 'size');
        await expect.poll(() => terminalText(page), pollOptions).toContain(`SIZE:${size.rows}x${size.cols}`);
        expect(await terminalSize(page)).toEqual(size);
        expect(inputData(await fixtureEvents(server))).toBe('size\r');
    });
});

test('base-path UI fetches its token and connects its WebSocket under the same prefix', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, { args: ['-W', '-b', '/nested/terminal'] }, async (server, { sockets }) => {
        const tokenUrl = new URL('token', server.url).href;
        const [tokenResponse, response] = await Promise.all([
            page.waitForResponse(response => response.url() === tokenUrl),
            page.goto(server.url),
        ]);
        expect(response?.status()).toBe(200);
        expect(new URL(server.url).pathname).toBe('/nested/terminal/');
        expect(tokenResponse.status()).toBe(200);
        await readyTerminal(page, server);
        const socket = socketFor(sockets, server);
        expect(new URL(socket.url).pathname).toBe('/nested/terminal/ws');
        expect(socket.closed).toBe(false);
        await echoRoundtrip(page, server, 'base-path-roundtrip');
    });
});

test('Basic-auth browser session authenticates HTTP and WebSocket keyboard roundtrips', async ({ browser }, testInfo) => {
    const credentials = { username: 'e2e-user', password: 'e2e-password' };
    const context = await browser.newContext({ httpCredentials: credentials });
    try {
        const page = await context.newPage();
        const credential = `${credentials.username}:${credentials.password}`;
        await withTerminal(page, testInfo, { args: ['-W', '-c', credential] }, async (server, { sockets }) => {
            const tokenUrl = new URL('token', server.url).href;
            const [tokenResponse, response] = await Promise.all([
                page.waitForResponse(response => response.url() === tokenUrl && response.status() === 200),
                page.goto(server.url),
            ]);
            expect(response?.status()).toBe(200);
            expect(await tokenResponse.json()).toHaveProperty('token', Buffer.from(credential).toString('base64'));
            await readyTerminal(page, server);
            expect(socketFor(sockets, server).closed).toBe(false);
            await echoRoundtrip(page, server, 'authenticated-roundtrip');
        });
    } finally {
        await context.close();
    }
});

function pidExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

test('disconnecting the browser terminates and reaps its fixture child', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, { args: ['-W'] }, async server => {
        const { pid } = await openTerminal(page, server);
        expect(pid).toBeGreaterThan(0);
        expect(pidExists(pid)).toBe(true);
        await page.close();
        // Signal 0 still succeeds for zombies; ESRCH proves removal, not merely
        // that the child has started exiting. Check before harness cleanup.
        await expect.poll(() => pidExists(pid), {
            ...pollOptions,
            message: `disconnected fixture PID ${pid} is reaped by ttyd`,
        }).toBe(false);
    });
});

test('normal child exit delivers FINAL before closing the browser WebSocket', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, { args: ['-t', 'disableReconnect=true'], mode: 'exit' }, async (server, { sockets }) => {
        const response = await page.goto(server.url);
        expect(response?.status()).toBe(200);
        await expect.poll(() => terminalText(page), pollOptions).toContain('FINAL:goodbye');
        const socket = socketFor(sockets, server);
        await expect.poll(() => socket.closed, pollOptions).toBe(true);
        const closeIndex = socket.events.findIndex(event => event.type === 'close');
        const outputBeforeClose = socket.events.slice(0, closeIndex)
            .filter(event => event.type === 'received' && event.data.startsWith('0'))
            .map(event => event.data.slice(1)).join('');
        expect(outputBeforeClose).toContain('FINAL:goodbye');
        await expect.poll(async () => (await fixtureEvents(server)).filter(event => event.type === 'exit'), pollOptions)
            .toHaveLength(1);
    });
});

test('terminal remains usable when WebGL contexts are unavailable', async ({ page }, testInfo) => {
    await withTerminal(page, testInfo, { args: ['-W', '-t', 'rendererType=webgl'] }, async server => {
        await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (contextId, ...args) {
                if (contextId === 'webgl' || contextId === 'webgl2') return null;
                return original.call(this, contextId, ...args);
            };
        });
        await openTerminal(page, server);
        await echoRoundtrip(page, server, 'without-webgl-roundtrip');
    });
});
