import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps/core/src/environments/guest"))
from apx_vm_session import desktop_environment


class GuestSessionTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.proc = Path(self.folder.name)

    def session(self, pid, display=":1", address="unix:path=/tmp/apx-test-bus", name="xfce4-session"):
        process = self.proc / str(pid)
        process.mkdir()
        (process / "comm").write_text(name)
        (process / "environ").write_bytes(
            f"DISPLAY={display}\0DBUS_SESSION_BUS_ADDRESS={address}\0PRIVATE_VALUE=not-inherited\0".encode()
        )

    def test_uses_the_desktop_bus_and_only_minimal_environment(self):
        self.session(10, display=":2")
        self.session(20, name="bash")
        self.session(30)
        environment = desktop_environment(self.proc)
        self.assertEqual(environment["DBUS_SESSION_BUS_ADDRESS"], "unix:path=/tmp/apx-test-bus")
        self.assertEqual(environment["DISPLAY"], ":1")
        self.assertEqual(environment["XDG_CURRENT_DESKTOP"], "XFCE")
        self.assertEqual(environment["XDG_RUNTIME_DIR"], f"/run/user/{os.getuid()}")
        self.assertNotIn("PRIVATE_VALUE", environment)

    def test_an_agent_screen_user_uses_only_its_own_display(self):
        self.session(10)
        self.session(20, display=":103", address="unix:path=/tmp/apx-agent-bus")
        with patch("apx_vm_session.os.getuid", return_value=2003), patch(
            "apx_vm_session.pwd.getpwuid", return_value=type("A", (), {"pw_dir": "/home/apx-a3", "pw_name": "apx-a3"})()
        ), patch.object(Path, "stat", return_value=type("S", (), {"st_uid": 2003})()):
            environment = desktop_environment(self.proc)
        self.assertEqual(environment["DISPLAY"], ":103")
        self.assertEqual(environment["HOME"], "/home/apx-a3")
        self.assertEqual(environment["DBUS_SESSION_BUS_ADDRESS"], "unix:path=/tmp/apx-agent-bus")

    def test_ignores_another_users_session(self):
        self.session(10)
        with patch("apx_vm_session.os.getuid", return_value=os.getuid() + 1):
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                desktop_environment(self.proc)

    def test_missing_or_nonlocal_bus_fails_without_creating_a_session(self):
        self.session(10, address="tcp:host=example.com,port=1234")
        self.session(20, address="")
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            desktop_environment(self.proc)

    def test_an_exited_process_does_not_hide_the_running_session(self):
        (self.proc / "10").mkdir()
        self.session(20, display=":1.0")
        self.assertEqual(desktop_environment(self.proc)["DISPLAY"], ":1.0")


if __name__ == "__main__":
    unittest.main()
