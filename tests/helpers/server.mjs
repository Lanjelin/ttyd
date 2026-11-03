import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = join(root, 'tests/helpers/fixture.py');
const active = new Set();

function signalGroup(pid, signal) {
    if (!pid) return;
    try {
        process.kill(-pid, signal);
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}

// Also cover worker interruption; normal teardown uses the bounded async stop().
process.once('exit', () => {
    for (const cleanup of active) cleanup();
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        for (const cleanup of active) cleanup();
        process.kill(process.pid, signal);
    });
}

function basePath(args) {
    let base = '';
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '-b' || arg === '--base-path') base = args[++index];
        else if (arg.startsWith('--base-path=')) base = arg.slice('--base-path='.length);
        else if (arg.startsWith('-b') && arg.length > 2) base = arg.slice(2);
    }
    return (base || '').replace(/\/+$/, '');
}

/** Start one loopback-only ttyd instance and its controlled PTY fixture. */
export async function startServer({ args = [], mode = 'interactive' } = {}) {
    if (process.platform !== 'linux') throw new Error('The ttyd E2E harness currently requires Linux');
    if (!['interactive', 'exit'].includes(mode)) throw new Error(`Unknown fixture mode: ${mode}`);
    const directory = await mkdtemp(join(tmpdir(), 'ttyd-e2e-'));
    const eventsPath = join(directory, 'events.jsonl');
    await writeFile(eventsPath, '');
    const binary = resolve(root, process.env.TTYD_BINARY || 'build/native/ttyd');
    const child = spawn(binary, [
        ...args, '-i', '127.0.0.1', '-p', '0', '--',
        process.env.PYTHON || 'python3', fixture, eventsPath, mode,
    ], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let captured = '';
    let spawnError;
    let closed = false;
    let stopping;
    const fixturePids = new Set();
    const capture = chunk => {
        captured += chunk.toString('utf8');
        for (const match of captured.matchAll(/started process, pid: (\d+)/g)) {
            fixturePids.add(Number(match[1]));
        }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', error => { spawnError = error; });
    child.on('close', () => { closed = true; });

    function collectFixturePids() {
        try {
            for (const line of readFileSync(eventsPath, 'utf8').split('\n')) {
                if (!line.endsWith('}')) continue;
                const event = JSON.parse(line);
                if (event.type === 'ready') fixturePids.add(event.pid);
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }

    function remainingFixtures() {
        collectFixturePids();
        return [...fixturePids].filter(pid => {
            try {
                // Never signal a recycled PID belonging to an unrelated process.
                return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').includes(eventsPath);
            } catch (error) {
                if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
                throw error;
            }
        });
    }

    function emergencyCleanup() {
        if (!closed) signalGroup(child.pid, 'SIGKILL');
        for (const pid of remainingFixtures()) signalGroup(pid, 'SIGKILL');
    }
    active.add(emergencyCleanup);

    async function stop() {
        if (stopping) return stopping;
        stopping = (async () => {
            try {
                if (!closed) signalGroup(child.pid, 'SIGTERM');
                let deadline = Date.now() + 3000;
                while (!closed && Date.now() < deadline) await delay(25);
                if (!closed) signalGroup(child.pid, 'SIGKILL');
                for (const pid of remainingFixtures()) signalGroup(pid, 'SIGKILL');
                deadline = Date.now() + 2000;
                while ((!closed || remainingFixtures().length > 0) && Date.now() < deadline) await delay(25);
                if (!closed || remainingFixtures().length > 0) {
                    throw new Error(`ttyd cleanup did not finish\n${captured}`);
                }
            } finally {
                emergencyCleanup();
                active.delete(emergencyCleanup);
                await rm(directory, { recursive: true, force: true });
            }
        })();
        return stopping;
    }

    try {
        const deadline = Date.now() + 10000;
        let match;
        while (!(match = captured.match(/Listening on port:\s*(\d+)/))) {
            if (spawnError) throw spawnError;
            if (closed) throw new Error(`ttyd exited before listening (${child.exitCode ?? child.signalCode})`);
            if (Date.now() >= deadline) throw new Error('Timed out discovering ttyd ephemeral port');
            await delay(25);
        }
        const url = `http://127.0.0.1:${match[1]}${basePath(args)}/`;
        return {
            url,
            wsUrl: `${url.replace(/^http:/, 'ws:')}ws`,
            eventsPath,
            directory,
            process: child,
            logs: () => captured,
            stop,
        };
    } catch (error) {
        const diagnostic = new Error(`${error.message}\nBinary: ${binary}\n${captured}`, { cause: error });
        try {
            await stop();
        } catch (cleanupError) {
            throw new AggregateError([diagnostic, cleanupError], 'ttyd startup and cleanup failed');
        }
        throw diagnostic;
    }
}
