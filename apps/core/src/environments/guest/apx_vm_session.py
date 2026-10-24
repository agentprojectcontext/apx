"""Use the existing guest desktop session without inheriting SSH or host variables."""
import os
import pwd
from pathlib import Path


def screen_display(uid):
    """An agent's screen user (uid 2000+n) has display :100+n; the owner's screen is :1."""
    return f":{uid - 1900}" if 2001 <= uid <= 2999 else ":1"


def desktop_environment(proc_root=Path("/proc")):
    uid = os.getuid()
    wanted = screen_display(uid)
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
        display = session.get("DISPLAY", "")
        if display not in (wanted, f"{wanted}.0"):
            continue
        address = session.get("DBUS_SESSION_BUS_ADDRESS", "")
        if not address.startswith("unix:"):
            continue
        account = pwd.getpwuid(uid)
        return {
            "HOME": account.pw_dir, "USER": account.pw_name, "LANG": "C.UTF-8",
            "PATH": "/usr/local/bin:/usr/bin:/bin", "DISPLAY": display,
            "XAUTHORITY": session.get("XAUTHORITY", f"{account.pw_dir}/.Xauthority"),
            "XDG_RUNTIME_DIR": f"/run/user/{uid}", "XDG_CURRENT_DESKTOP": "XFCE",
            "DESKTOP_SESSION": "xfce", "DBUS_SESSION_BUS_ADDRESS": address,
            "http_proxy": "http://127.0.0.1:3128", "https_proxy": "http://127.0.0.1:3128",
            "HTTP_PROXY": "http://127.0.0.1:3128", "HTTPS_PROXY": "http://127.0.0.1:3128",
            "no_proxy": "localhost,127.0.0.1,::1", "NO_PROXY": "localhost,127.0.0.1,::1",
        }
    raise RuntimeError("This screen's desktop session is unavailable; start the computer and retry")
