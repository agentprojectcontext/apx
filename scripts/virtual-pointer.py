"""Park Xvfb's idle pointer outside native views before synthetic input starts."""
import ctypes
import os

if os.environ.get("APX_TEST_VIRTUAL_DISPLAY") != "1":
    raise RuntimeError("This helper requires an explicitly disposable virtual display")

x11 = ctypes.CDLL("libX11.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XWarpPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
                           ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_int]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("The virtual display is unavailable")
try:
    x11.XWarpPointer(display, 0, x11.XDefaultRootWindow(display), 0, 0, 0, 0, 0, 0)
    x11.XFlush(display)
finally:
    x11.XCloseDisplay(display)
