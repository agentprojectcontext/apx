#!/usr/bin/env python3
"""Bridge Chromium's private CDP pipe through SSH; no debugging TCP listener."""
import os
import pwd
import selectors
import sys
from pathlib import Path
import signal
import subprocess
from apx_vm_session import desktop_environment

incoming, command = os.pipe()
reply, outgoing = os.pipe()
environment = desktop_environment()
# Each screen user's own log: a shared one in /tmp would belong to the first agent and lock out the rest.
log_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(pwd.getpwuid(os.getuid()).pw_dir) / ".cache/apx/browser.log"
log_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
with open(log_path, "ab", buffering=0) as log:
    child = subprocess.Popen(
        ["/bin/bash", "-c", 'exec 3<&"$1" 4>&"$2"; shift 2; exec "$@"', "apx-browser",
         str(incoming), str(outgoing), "/usr/bin/chromium", "--remote-debugging-pipe",
         f"--user-data-dir={pwd.getpwuid(os.getuid()).pw_dir}/.config/apx-agent-browser", "--ozone-platform=x11",
         "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble",
         "--proxy-server=http://127.0.0.1:3128", "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
         "--disable-dev-shm-usage", "--disable-gpu", "--disable-sync", "--disable-extensions",
         "--window-size=1100,740", "--window-position=10,25", "about:blank"],
        env=environment, pass_fds=(incoming, outgoing), stdin=subprocess.DEVNULL,
        stdout=log, stderr=log, start_new_session=True,
    )
os.close(incoming)
os.close(outgoing)

def stop(*_args):
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGHUP, stop)
poll = selectors.DefaultSelector()
poll.register(0, selectors.EVENT_READ, command)
poll.register(reply, selectors.EVENT_READ, 1)
try:
    while child.poll() is None:
        for key, _ in poll.select(timeout=1):
            data = os.read(key.fd, 65536)
            if not data:
                raise EOFError()
            while data:
                count = os.write(key.data, data)
                data = data[count:]
except (EOFError, BrokenPipeError):
    pass
finally:
    poll.close()
    stop()
    try:
        child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
