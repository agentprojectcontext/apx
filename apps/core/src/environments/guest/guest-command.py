#!/usr/bin/env python3
import base64
import fcntl
import json
import os
import pwd
import signal
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from apx_vm_session import desktop_environment

home = Path(pwd.getpwuid(os.getuid()).pw_dir)
state = home / ".local/state/apx-vm/commands"
state.mkdir(parents=True, exist_ok=True, mode=0o700)
operation = str(uuid.UUID(sys.argv[2])) if len(sys.argv) > 2 else str(uuid.uuid4())
record = state / operation
lock = open(state / "lock", "a")

def terminate(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

def identity(pid):
    return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]

if sys.argv[1] == "--cancel":
    with lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if record.exists():
            data = json.loads(record.read_text())
            pid = data.get("pid")
            if pid and Path(f"/proc/{pid}").exists() and identity(pid) == data["start"]:
                terminate(pid)
        # A late SSH command cannot start after its cancellation was acknowledged.
        record.write_text(json.dumps({"canceled": True}))
    print(json.dumps({"ok": True}))
    sys.exit(0)

command = base64.b64decode(sys.argv[1], validate=True).decode("utf-8")
os.chdir(home / "work")
transcript = str(home / "work/.apx-terminal.log")
if os.path.exists(transcript) and os.path.getsize(transcript) > 2 * 1024 * 1024:
    open(transcript, "w").close()
with open(transcript, "a") as screen:
    screen.write(f"\n$ {command}\n")
try:
    environment = desktop_environment()
except RuntimeError as error:
    print(json.dumps({"code": 69, "output": str(error)}))
    sys.exit(0)
with tempfile.TemporaryFile() as output:
    with lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if record.exists() and json.loads(record.read_text()).get("canceled"):
            print(json.dumps({"code": 130, "output": "Interrupted: manual control requested."}))
            sys.exit(0)
        child = subprocess.Popen(
            ["/bin/bash", "-c", command], env=environment,
            stdin=subprocess.DEVNULL, stdout=output, stderr=output,
            start_new_session=True,
        )
        record.write_text(json.dumps({"pid": child.pid, "start": identity(child.pid)}))
    def interrupted(signum, frame):
        terminate(child.pid)
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    code = 0
    try:
        code = child.wait(timeout=45)
    except subprocess.TimeoutExpired:
        code = 124
    finally:
        # Reap descendants even when the shell itself returned successfully.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
    output.seek(0)
    text = output.read(131072).decode("utf-8", errors="replace")
    with open(transcript, "a") as screen:
        screen.write(f"{text}\n[exit {code}]\n")
    print(json.dumps({"code": code, "output": text}))
