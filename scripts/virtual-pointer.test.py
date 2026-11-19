"""Exercise pointer parking after the helper's last X11 connection closes."""
import ctypes
import os
import select
import subprocess
import sys

read_fd, write_fd = os.pipe()
args = ["Xvfb", "-displayfd", str(write_fd), "-screen", "0", "1600x1000x24", "-nolisten", "tcp"]
if "--reset" not in sys.argv:
    args.append("-noreset")
server = subprocess.Popen(args, pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
os.close(write_fd)
try:
    if not select.select([read_fd], [], [], 10)[0]:
        raise RuntimeError("The disposable display did not start")
    display_name = ":" + os.read(read_fd, 64).decode().strip()
    env = {**os.environ, "DISPLAY": display_name, "APX_TEST_VIRTUAL_DISPLAY": "1"}
    subprocess.run([sys.executable, "scripts/virtual-pointer.py"], env=env, check=True, timeout=10)
    x11 = ctypes.CDLL("libX11.so.6")
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
                                 ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int),
                                 ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
                                 ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_uint)]
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    display = x11.XOpenDisplay(display_name.encode())
    if not display:
        raise RuntimeError("The disposable display is unavailable")
    try:
        root, child = ctypes.c_ulong(), ctypes.c_ulong()
        x, y, local_x, local_y = (ctypes.c_int() for _ in range(4))
        mask = ctypes.c_uint()
        x11.XQueryPointer(display, x11.XDefaultRootWindow(display), ctypes.byref(root), ctypes.byref(child),
                          ctypes.byref(x), ctypes.byref(y), ctypes.byref(local_x), ctypes.byref(local_y),
                          ctypes.byref(mask))
        position = (x.value, y.value)
        print("Pointer after reconnect:", position, flush=True)
        assert position == (0, 0), position
    finally:
        x11.XCloseDisplay(display)
finally:
    os.close(read_fd)
    server.terminate()
    server.wait(timeout=10)
