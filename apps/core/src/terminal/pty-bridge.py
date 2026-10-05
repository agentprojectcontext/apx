#!/usr/bin/env python3
"""Run a command on a pseudo-terminal and relay it over stdin/stdout.

A shell (and the CLIs it starts) needs a real tty: raw keys, a window size, colors. Node has no pty of its own
and node-pty is a native module (a compiler on every install), while Python's pty module is a few lines.

usage: pty-bridge.py <rows> <cols> <command> [args...]

stdin is typed into the pty, the pty's output comes out on stdout. File descriptor 3, when open, takes
"<rows> <cols>" lines to resize the window. Exits with the child's status (1 when a signal ended it).
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

BUF = 65536
CONTROL = 3


def resize(master, pid, rows, cols):
    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        os.kill(pid, signal.SIGWINCH)
    except OSError:
        pass


def main():
    if len(sys.argv) < 4:
        sys.stderr.write("usage: pty-bridge.py <rows> <cols> <command> [args...]\n")
        return 2

    rows, cols = int(sys.argv[1]), int(sys.argv[2])
    argv = sys.argv[3:]

    pid, master = pty.fork()
    if pid == 0:
        # The child becomes the command; a failure has to reach the pty so the terminal shows it.
        try:
            os.execvp(argv[0], argv)
        except OSError as e:
            sys.stderr.write("apx: cannot run %s: %s\r\n" % (argv[0], e))
            sys.stderr.flush()
        os._exit(127)

    resize(master, pid, rows, cols)

    try:
        os.fstat(CONTROL)
        control = [CONTROL]
    except OSError:
        control = []
    pending = b""
    stdin_open = True
    try:
        while True:
            watch = [master] + ([sys.stdin.fileno()] if stdin_open else []) + control
            try:
                ready, _, _ = select.select(watch, [], [])
            except InterruptedError:
                continue

            if master in ready:
                try:
                    data = os.read(master, BUF)
                except OSError:
                    break  # the child closed the pty: it is over
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)

            if stdin_open and sys.stdin.fileno() in ready:
                try:
                    data = os.read(sys.stdin.fileno(), BUF)
                except OSError:
                    data = b""
                if data:
                    os.write(master, data)
                else:
                    stdin_open = False

            if control and CONTROL in ready:
                chunk = os.read(CONTROL, 1024)
                if not chunk:
                    control = []
                    continue
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    parts = line.split()
                    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                        resize(master, pid, int(parts[0]), int(parts[1]))
    finally:
        try:
            os.close(master)
        except OSError:
            pass

    _, status = os.waitpid(pid, 0)
    return os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1


if __name__ == "__main__":
    sys.exit(main())
