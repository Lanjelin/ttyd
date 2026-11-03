import { test as base, expect } from '@playwright/test';
import WebSocket from 'ws';
import { readFile } from 'node:fs/promises';
import { startServer } from '../helpers/server.mjs';

async function events(server) {
    // A concurrent append may leave the last line incomplete for this read.
    return (await readFile(server.eventsPath, 'utf8')).split('\n').slice(0, -1).map(line => JSON.parse(line));
}

function inputData(records) {
    return records.filter(event => event.type === 'input').map(event => event.data).join('');
}

function observeSession(server, options = {}) {
    const socket = new WebSocket(server.wsUrl, 'tty', { handshakeTimeout: 3000, ...options });
    const session = { socket, opened: false, close: null, rejection: null, errors: [], frames: [] };
    // All observers are installed before awaiting open; immediate child output
    // and close events must not disappear between consecutive awaits.
    socket.on('open', () => { session.opened = true; });
    socket.on('message', (data, binary) => {
        session.frames.push({ data: Buffer.from(data), binary });
    });
    socket.on('error', error => { session.errors.push(error.message); });
    socket.on('close', (code, reason) => { session.close = { code, reason: reason.toString() }; });
    socket.on('unexpected-response', (_request, response) => {
        session.rejection = { status: response.statusCode, headers: response.headers };
        response.resume();
        socket.terminate();
    });
    Object.defineProperty(session, 'output', {
        get: () => Buffer.concat(session.frames.filter(frame => frame.data[0] === 0x30).map(frame => frame.data.subarray(1))).toString('utf8'),
    });
    session.send = (data, options = { binary: true }) => new Promise((resolve, reject) => {
        if (socket.readyState !== WebSocket.OPEN) {
            reject(new Error(`Cannot send on closed socket: ${JSON.stringify(session.close)}`));
            return;
        }
        const timeout = setTimeout(() => reject(new Error('WebSocket send timed out')), 3000);
        socket.send(data, options, error => {
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve();
        });
    });
    session.waitOpen = async () => {
        await expect.poll(() => session.opened || session.close !== null || session.rejection !== null || session.errors.length > 0).toBe(true);
        expect(session.opened, JSON.stringify({ rejection: session.rejection, errors: session.errors })).toBe(true);
        return session;
    };
    session.handshake = ({ token = '', cols = 80, rows = 24 } = {}) => session.send(Buffer.from(JSON.stringify({ AuthToken: token, columns: cols, rows })));
    session.resize = (cols, rows) => session.send(Buffer.from(`1${JSON.stringify({ columns: cols, rows })}`));
    session.input = data => session.send(Buffer.concat([Buffer.from('0'), Buffer.from(data)]));
    return session;
}

const test = base.extend({
    harness: async ({}, use, testInfo) => {
        const servers = [];
        const sessions = [];
        try {
            await use({
                start: async options => {
                    const server = await startServer(options);
                    servers.push(server);
                    return server;
                },
                connect: (server, options) => {
                    const session = observeSession(server, options);
                    sessions.push(session);
                    return session;
                },
            });
        } finally {
            for (const { socket } of sessions) {
                if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
            }
            const eventLogs = await Promise.all(servers.map(server => readFile(server.eventsPath, 'utf8').catch(error => String(error))));
            const cleanup = await Promise.allSettled(servers.map(server => server.stop()));
            const failures = cleanup.filter(result => result.status === 'rejected');
            if (testInfo.status !== testInfo.expectedStatus || failures.length > 0) {
                for (let index = 0; index < servers.length; index++) {
                    await testInfo.attach(`server-${index}.log`, { body: servers[index].logs(), contentType: 'text/plain' });
                    await testInfo.attach(`events-${index}.jsonl`, { body: eventLogs[index], contentType: 'application/x-ndjson' });
                }
                await testInfo.attach('websocket-transcript.json', {
                    body: JSON.stringify(sessions.map(({ opened, close, rejection, errors, frames }) => ({
                        opened, close, rejection, errors,
                        frames: frames.map(({ binary, data }) => ({ binary, hex: data.toString('hex'), utf8: data.toString('utf8') })),
                    })), null, 2),
                    contentType: 'application/json',
                });
            }
            if (failures.length > 0) throw new AggregateError(failures.map(result => result.reason), 'Server cleanup failed');
        }
    },
});

async function token(server, headers = {}) {
    const response = await fetch(new URL('token', server.url), { headers, signal: AbortSignal.timeout(3000) });
    expect(response.status).toBe(200);
    return (await response.json()).token;
}

async function ready(server, session, { cols = 80, rows = 24, token = '' } = {}) {
    await session.waitOpen();
    await session.handshake({ cols, rows, token });
    await expect.poll(() => session.output).toContain('READY\r\n');
    await expect.poll(async () => (await events(server)).find(event => event.type === 'ready')).toMatchObject({ rows, cols });
}

async function resizeBarrier(server, session, cols, rows) {
    await session.resize(cols, rows);
    const resized = async () => (await events(server))
        .some(event => event.type === 'resize' && event.cols === cols && event.rows === rows);
    await expect.poll(async () => server.process.exitCode !== null || server.process.signalCode !== null
        || session.close !== null || await resized()).toBe(true);
    expect({ code: server.process.exitCode, signal: server.process.signalCode }, server.logs())
        .toEqual({ code: null, signal: null });
    expect(session.close, 'session survives until the resize acknowledgment').toBeNull();
    expect(await resized(), 'child acknowledges the requested PTY size').toBe(true);
}

async function rejectsUpgrade(session) {
    await expect.poll(() => session.close !== null || session.rejection !== null).toBe(true);
    expect(session.opened).toBe(false);
    // libwebsockets versions differ in the HTTP response used by filter callbacks.
    if (session.rejection) {
        expect(session.rejection.status).toBeGreaterThanOrEqual(400);
        expect(session.rejection.status).toBeLessThan(500);
    }
}

async function assertRecovery(harness, server) {
    expect(server.process.exitCode, server.logs()).toBeNull();
    expect(server.process.signalCode, server.logs()).toBeNull();
    const response = await fetch(new URL('token', server.url), { signal: AbortSignal.timeout(3000) });
    expect(response.status).toBe(200);
    const session = harness.connect(server);
    await ready(server, session);
    await session.input('echo recovered\n');
    await expect.poll(() => session.output).toContain('ECHO:recovered\r\n');
}

test('real token and dimension handshake produces binary output and forwards input/resize', async ({ harness }) => {
    const server = await harness.start({ args: ['-W'] });
    const authToken = await token(server);
    const session = harness.connect(server);
    await ready(server, session, { token: authToken, cols: 113, rows: 37 });
    await session.input('echo protocol\n');
    await expect.poll(() => session.output).toContain('ECHO:protocol\r\n');
    await expect.poll(async () => inputData(await events(server))).toBe('echo protocol\n');
    const outputFrames = session.frames.filter(frame => frame.data[0] === 0x30);
    for (const frame of outputFrames) {
        expect(frame.binary).toBe(true);
    }
    await resizeBarrier(server, session, 101, 43);
    await session.input('size\n');
    await expect.poll(() => session.output).toContain('SIZE:43x101\r\n');
});

test('read-only ignores input before an ordered resize processing barrier', async ({ harness }) => {
    const server = await harness.start();
    const session = harness.connect(server);
    await ready(server, session);
    await session.input('echo must-not-arrive\n');
    await resizeBarrier(server, session, 97, 33);
    expect(inputData(await events(server))).toBe('');
    expect(session.output).not.toContain('ECHO:must-not-arrive');
    expect(session.close).toBeNull();
});

test('Basic HTTP and WebSocket credentials and the session token are enforced', async ({ harness }) => {
    const server = await harness.start({ args: ['-W', '-c', 'tester:secret'] });
    const authorization = `Basic ${Buffer.from('tester:secret').toString('base64')}`;
    for (const endpoint of ['', 'token']) {
        const response = await fetch(new URL(endpoint, server.url), { signal: AbortSignal.timeout(3000) });
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toContain('Basic');
        await response.arrayBuffer();
    }
    const wrong = await fetch(new URL('token', server.url), {
        headers: { Authorization: `Basic ${Buffer.from('tester:wrong').toString('base64')}` },
        signal: AbortSignal.timeout(3000),
    });
    expect(wrong.status).toBe(401);
    await wrong.arrayBuffer();
    await rejectsUpgrade(harness.connect(server));
    await rejectsUpgrade(harness.connect(server, { headers: { Authorization: 'Basic invalid' } }));
    expect(await events(server)).toEqual([]);
    const headers = { Authorization: authorization };
    const authToken = await token(server, headers);
    expect(authToken).toBe(Buffer.from('tester:secret').toString('base64'));
    for (const candidate of [undefined, 'not-the-token']) {
        const rejected = harness.connect(server, { headers });
        await rejected.waitOpen();
        await rejected.send(Buffer.from(JSON.stringify({ columns: 80, rows: 24, ...(candidate === undefined ? {} : { AuthToken: candidate }) })));
        await expect.poll(() => rejected.close?.code).toBe(1008);
        expect(await events(server)).toEqual([]);
    }
    const accepted = harness.connect(server, { headers });
    await ready(server, accepted, { token: authToken });
    await accepted.input('echo authenticated\n');
    await expect.poll(() => accepted.output).toContain('ECHO:authenticated\r\n');
});

test('origin checking rejects a mismatch and accepts the exact loopback origin', async ({ harness }) => {
    const server = await harness.start({ args: ['-W', '-O'] });
    await rejectsUpgrade(harness.connect(server, { origin: 'http://example.invalid' }));
    await rejectsUpgrade(harness.connect(server));
    expect(await events(server)).toEqual([]);
    const session = harness.connect(server, { origin: new URL(server.url).origin });
    await ready(server, session);
    await session.input('echo matching-origin\n');
    await expect.poll(() => session.output).toContain('ECHO:matching-origin\r\n');
});

test('fragmented handshake and input are reassembled exactly once', async ({ harness }) => {
    const server = await harness.start({ args: ['-W', '-c', 'fragment:secret'] });
    const headers = { Authorization: `Basic ${Buffer.from('fragment:secret').toString('base64')}` };
    const authToken = await token(server, headers);
    const session = harness.connect(server, { headers });
    await session.waitOpen();
    const handshake = Buffer.from(JSON.stringify({ AuthToken: authToken, columns: 109, rows: 39 }));
    await session.send(Buffer.alloc(0), { binary: true, fin: false });
    await session.send(handshake.subarray(0, 1), { binary: true, fin: false });
    await session.send(handshake.subarray(1, 23), { binary: true, fin: false });
    await session.send(handshake.subarray(23), { binary: true, fin: false });
    await session.send(Buffer.alloc(0), { binary: true, fin: true });
    await expect.poll(() => session.output).toContain('READY\r\n');
    await expect.poll(async () => (await events(server)).find(event => event.type === 'ready')).toMatchObject({ cols: 109, rows: 39 });
    const input = Buffer.from('0echo fragmented-exactly\n');
    await session.send(input.subarray(0, 1), { binary: true, fin: false });
    await session.send(Buffer.alloc(0), { binary: true, fin: false });
    await session.send(input.subarray(1, 9), { binary: true, fin: false });
    await session.send(input.subarray(9), { binary: true, fin: false });
    await session.send(Buffer.alloc(0), { binary: true, fin: true });
    await expect.poll(() => session.output).toContain('ECHO:fragmented-exactly\r\n');
    await resizeBarrier(server, session, 110, 40);
    expect(inputData(await events(server))).toBe('echo fragmented-exactly\n');
    expect(session.output.split('ECHO:fragmented-exactly').length - 1).toBe(1);
});

test('empty binary messages preserve the active session and subsequent service', async ({ harness }) => {
    const server = await harness.start({ args: ['-W'] });
    const session = harness.connect(server);
    await ready(server, session);
    await session.send(Buffer.alloc(0));
    // This is deliberately a survival assertion, not an expected-failure marker:
    // a crash or disconnect retains diagnostics and must remain a failing test.
    await resizeBarrier(server, session, 93, 31);
    expect(session.close).toBeNull();
    await session.input('echo after-empty\n');
    await expect.poll(() => session.output).toContain('ECHO:after-empty\r\n');
    await assertRecovery(harness, server);
});

test('unknown command messages do not contaminate input or prevent recovery', async ({ harness }) => {
    const server = await harness.start({ args: ['-W'] });
    const session = harness.connect(server);
    await ready(server, session);
    await session.send(Buffer.from('~not-a-protocol-command'));
    await resizeBarrier(server, session, 94, 32);
    expect(inputData(await events(server))).toBe('');
    await session.input('echo after-invalid\n');
    await expect.poll(() => session.output).toContain('ECHO:after-invalid\r\n');
    await assertRecovery(harness, server);
});

test('malformed handshake is isolated and a fresh session still works', async ({ harness }) => {
    const server = await harness.start({ args: ['-W'] });
    const malformed = harness.connect(server);
    await malformed.waitOpen();
    await malformed.send(Buffer.from('{"columns":'));
    // Do not prescribe whether malformed JSON is rejected or interpreted with
    // defaults. A following WS ping provides an ordered transport-processing
    // barrier when the peer stays open; a close is also a valid disposition.
    let pong = false;
    malformed.socket.once('pong', () => { pong = true; });
    if (malformed.socket.readyState === WebSocket.OPEN) malformed.socket.ping('barrier');
    await expect.poll(() => pong || malformed.close !== null).toBe(true);
    malformed.socket.terminate();
    await expect.poll(() => malformed.close !== null).toBe(true);
    await assertRecovery(harness, server);
});
