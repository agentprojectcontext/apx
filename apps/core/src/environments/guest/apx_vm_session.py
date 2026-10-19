"""Use the existing guest desktop session without inheriting SSH or host variables."""
import os
from pathlib import Path


def desktop_environment(proc_root=Path("/proc")):
    uid = os.getuid()
    for process in proc_root.iterdir():
        if not process.name.isdigit():
            continue
        try:
            if process.stat().st_uid != uid or (process / "comm").read_text().strip() != "xfce4-session":
                continue
            with (process / "environ").open("rb") as source:
                entries = source.read(65536).decode("utf-8", errors="replace").split("\0")
            session = dict(entry.split("=", 1) for entry in entries if "=" in entry)
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        if session.get("DISPLAY") not in (":1", ":1.0"):
            continue
        address = session.get("DBUS_SESSION_BUS_ADDRESS", "")
        if not address.startswith("unix:"):
            continue
        return {
            "HOME": "/home/apx-worker", "USER": "apx-worker", "LANG": "C.UTF-8",
            "PATH": "/usr/local/bin:/usr/bin:/bin", "DISPLAY": session["DISPLAY"],
            "XDG_RUNTIME_DIR": f"/run/user/{uid}", "XDG_CURRENT_DESKTOP": "XFCE",
            "DESKTOP_SESSION": "xfce", "DBUS_SESSION_BUS_ADDRESS": address,
            "http_proxy": "http://127.0.0.1:3128", "https_proxy": "http://127.0.0.1:3128",
            "HTTP_PROXY": "http://127.0.0.1:3128", "HTTPS_PROXY": "http://127.0.0.1:3128",
            "no_proxy": "localhost,127.0.0.1,::1", "NO_PROXY": "localhost,127.0.0.1,::1",
        }
    raise RuntimeError("The Xfce session on display :1 is unavailable; start the VM desktop and retry")
