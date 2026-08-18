#!/usr/bin/env python3
"""Run a command on a pseudo-terminal and relay it over stdin/stdout.

The coding CLIs APX resumes — claude, codex, opencode — are terminal programs:
they draw an alt-screen UI, read keys in raw mode, and ask the tty how wide it
is. A plain pipe gives them none of that, so they either refuse to start or
render into nothing. Something has to allocate a real pty.

The two obvious candidates don't fit. macOS `script(1)` calls tcgetattr on its
own stdin and exits when that isn't a terminal, which is exactly our case (the
daemon feeds it a pipe). `node-pty` would work, but it is a native module, and
APX installs globally through npm onto machines that may have no compiler.
Python's pty module is already load-bearing for the voice stack, costs nothing
extra here, and is a few lines.

usage: pty-bridge.py <rows> <cols> <command> [args...]

Exits with the child's status, or 1 if it was killed by a signal. Closing our
stdin does not end the session — the child decides when it is done.
"""

import fcntl
import os
import pty
import select
import struct
import sys
import termios

BUF = 65536


def main():
    if len(sys.argv) < 4:
        sys.stderr.write("usage: pty-bridge.py <rows> <cols> <command> [args...]\n")
        return 2

    rows, cols = int(sys.argv[1]), int(sys.argv[2])
    argv = sys.argv[3:]

    pid, master = pty.fork()
    if pid == 0:
        # Child: becomes the CLI. execvp only returns on failure, and the
        # message has to reach the pty (our stderr is the pty now) so the user
        # sees "command not found" in the terminal instead of a blank panel.
        try:
            os.execvp(argv[0], argv)
        except OSError as e:
            sys.stderr.write("apx: cannot run %s: %s\r\n" % (argv[0], e))
            sys.stderr.flush()
        os._exit(127)

    # Tell the child how big its window is before it draws anything.
    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass

    stdin_open = True
    try:
        while True:
            watch = [master] + ([sys.stdin.fileno()] if stdin_open else [])
            try:
                ready, _, _ = select.select(watch, [], [])
            except InterruptedError:
                continue

            if master in ready:
                try:
                    data = os.read(master, BUF)
                except OSError:
                    break  # child closed the pty — the session is over
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
                    # Our side hung up. Stop watching stdin, but keep relaying
                    # the child's output until it exits on its own.
                    stdin_open = False
    finally:
        try:
            os.close(master)
        except OSError:
            pass

    _, status = os.waitpid(pid, 0)
    return os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1


if __name__ == "__main__":
    sys.exit(main())
