#!/usr/bin/env python3
"""Controlled raw PTY child for the browser and wire-protocol suites."""

import ctypes
import json
import os
import select
import signal
import sys
import termios
import tty


def main():
    events_path, mode = sys.argv[1:3]
    # forkpty children have their own session, outside the server's process group.
    # Do not leave one alive if ttyd crashes before its usual PTY cleanup runs.
    if sys.platform == "linux":
        parent = os.getppid()
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG
            raise OSError(ctypes.get_errno(), "prctl(PR_SET_PDEATHSIG)")
        if os.getppid() != parent or parent == 1:
            return

    events = os.open(events_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)

    def record(kind, **fields):
        data = json.dumps({"type": kind, **fields}, ensure_ascii=True) + "\n"
        os.write(events, data.encode("utf-8"))

    def dimensions():
        size = os.get_terminal_size(sys.stdin.fileno())
        return {"rows": size.lines, "cols": size.columns}

    pending_resize = False

    def resized(_signum, _frame):
        nonlocal pending_resize
        pending_resize = True

    def terminated(_signum, _frame):
        raise SystemExit(0)

    original = termios.tcgetattr(sys.stdin.fileno())
    wake_read, wake_write = os.pipe2(os.O_NONBLOCK | os.O_CLOEXEC)
    previous_wakeup_fd = signal.set_wakeup_fd(wake_write)
    try:
        tty.setraw(sys.stdin.fileno(), termios.TCSANOW)
        signal.signal(signal.SIGWINCH, resized)
        signal.signal(signal.SIGHUP, terminated)
        signal.signal(signal.SIGTERM, terminated)
        record("ready", pid=os.getpid(), **dimensions())
        os.write(sys.stdout.fileno(), b"READY\r\n")
        if mode == "exit":
            os.write(sys.stdout.fileno(), b"FINAL:goodbye\r\n")
            return
        if mode != "interactive":
            raise ValueError("unknown fixture mode: " + mode)

        pending = bytearray()
        previous_cr = False
        while True:
            readable, _, _ = select.select([sys.stdin.fileno(), wake_read], [], [])
            chunks = []
            # Drain already-delivered input before publishing a resize barrier.
            while select.select([sys.stdin.fileno()], [], [], 0)[0]:
                chunk = os.read(sys.stdin.fileno(), 65536)
                if not chunk:
                    return
                # latin-1 provides a reversible one-codepoint-per-byte record.
                record("input", data=chunk.decode("latin-1"))
                chunks.append(chunk)
            if wake_read in readable:
                os.read(wake_read, 65536)
            if pending_resize:
                pending_resize = False
                record("resize", **dimensions())
            data = b"".join(chunks)
            for byte in data:
                if byte in (10, 13):
                    if byte == 10 and previous_cr:
                        previous_cr = False
                        continue
                    command = bytes(pending)
                    pending.clear()
                    previous_cr = byte == 13
                    if command.startswith(b"echo "):
                        os.write(sys.stdout.fileno(), b"ECHO:" + command[5:] + b"\r\n")
                    elif command == b"size":
                        size = dimensions()
                        os.write(sys.stdout.fileno(), f"SIZE:{size['rows']}x{size['cols']}\r\n".encode("ascii"))
                    elif command == b"exit":
                        os.write(sys.stdout.fileno(), b"FINAL:goodbye\r\n")
                        return
                else:
                    previous_cr = False
                    pending.append(byte)
    finally:
        record("exit")
        try:
            termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, original)
        except termios.error:
            pass  # ttyd may already have closed the master on disconnect.
        os.close(events)
        signal.set_wakeup_fd(previous_wakeup_fd)
        os.close(wake_read)
        os.close(wake_write)


if __name__ == "__main__":
    main()
