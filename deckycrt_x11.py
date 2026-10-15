"""Read and set Gamescope's effect property without shelling out to xprop.

The plugin's whole whole-screen mode hangs on one X root-window property,
`GAMESCOPE_RESHADE_EFFECT`. The obvious way to touch it is the `xprop` binary,
but that is an X utility a minimal gamescope host may not install — SteamOS's
image is small and its contents are not something a plugin should assume. The
alternative is to be an X client: `libX11` is present wherever Xwayland runs,
which is exactly where this plugin has anything to do, and ctypes reaches it
without adding a dependency to the plugin.

So: this is the plugin's only X code. The property name is baked in because
that is the only property it has any business reading or writing.

Read failure returns None ("could not ask"); an absent or empty property returns
"" ("nothing applied"). Those are different answers and the caller decides what
to do about it — never this module.
"""

import ctypes
import ctypes.util

EFFECT_PROPERTY = "GAMESCOPE_RESHADE_EFFECT"

# Xlib's XGetWindowProperty status codes.
_SUCCESS = 0

_lib = None
_loaded = False


class X11Unavailable(RuntimeError):
    """libX11 could not be loaded, so there is no way to be an X client."""


def _load():
    """Load libX11 and pin every prototype this module uses. Cached."""
    global _lib, _loaded
    if _loaded:
        return _lib
    _loaded = True
    try:
        name = ctypes.util.find_library("X11") or "libX11.so.6"
        lib = ctypes.CDLL(name)
    except OSError:
        return None

    lib.XOpenDisplay.argtypes = [ctypes.c_char_p]
    lib.XOpenDisplay.restype = ctypes.c_void_p
    lib.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    lib.XDefaultRootWindow.restype = ctypes.c_ulong
    lib.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    lib.XInternAtom.restype = ctypes.c_ulong
    lib.XGetWindowProperty.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long,
        ctypes.c_long, ctypes.c_int, ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int),
        ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong),
        ctypes.POINTER(ctypes.c_void_p)]
    lib.XGetWindowProperty.restype = ctypes.c_int
    lib.XChangeProperty.argtypes = [
        ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong,
        ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_ubyte),
        ctypes.c_int]
    lib.XChangeProperty.restype = ctypes.c_int
    lib.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.XFree.argtypes = [ctypes.c_void_p]
    lib.XCloseDisplay.argtypes = [ctypes.c_void_p]
    _lib = lib
    return _lib


def available() -> bool:
    """Whether this plugin can be an X client at all."""
    return _load() is not None


class _Connection:
    """One short-lived connection to an X server's root window.

    Not a long-lived handle: Xlib is not thread-safe, the plugin touches the
    property a handful of times per mode change, and a fresh connection cannot
    go stale behind Gamescope's back.
    """

    def __init__(self, display):
        lib = _load()
        if lib is None:
            raise X11Unavailable("libX11 could not be loaded")
        self._lib = lib
        self.display = display
        self.conn = lib.XOpenDisplay(None if display is None else display.encode())
        if not self.conn:
            raise X11Unavailable(f"cannot open display {display!r}")
        self.root = lib.XDefaultRootWindow(self.conn)

    def close(self):
        if self.conn:
            self._lib.XCloseDisplay(self.conn)
            self.conn = None

    def has_property(self):
        """Whether this root window carries the property at all.

        Not the same as "the atom exists": every X server in a session can know
        the atom, so that says nothing about which one Gamescope is running on.
        Only Gamescope's Xwayland has the property *set* (as an empty string at
        startup). Returns None when the question cannot be asked.
        """
        lib = self._lib
        atom = lib.XInternAtom(self.conn, EFFECT_PROPERTY.encode(), True)
        if not atom:
            return False
        actual_type = ctypes.c_ulong(0)
        actual_format = ctypes.c_int(0)
        nitems = ctypes.c_ulong(0)
        bytes_after = ctypes.c_ulong(0)
        data = ctypes.c_void_p(None)
        status = lib.XGetWindowProperty(
            self.conn, self.root, atom, 0, 0, False, 0,
            ctypes.byref(actual_type), ctypes.byref(actual_format),
            ctypes.byref(nitems), ctypes.byref(bytes_after),
            ctypes.byref(data))
        try:
            if status != _SUCCESS:
                return None
            return actual_type.value != 0
        finally:
            if data.value:
                lib.XFree(data)

    def get(self):
        """The property's text, "" when absent/empty, or None when unreadable."""
        lib = self._lib
        atom = lib.XInternAtom(self.conn, EFFECT_PROPERTY.encode(), True)
        if not atom:
            return ""
        actual_type = ctypes.c_ulong(0)
        actual_format = ctypes.c_int(0)
        nitems = ctypes.c_ulong(0)
        bytes_after = ctypes.c_ulong(0)
        data = ctypes.c_void_p(None)
        status = lib.XGetWindowProperty(
            self.conn, self.root, atom, 0, 4096, False, 0,
            ctypes.byref(actual_type), ctypes.byref(actual_format),
            ctypes.byref(nitems), ctypes.byref(bytes_after),
            ctypes.byref(data))
        try:
            if status != _SUCCESS:
                return None
            if actual_type.value == 0 or not data.value or not nitems.value:
                return ""
            width = max(actual_format.value // 8, 1)
            raw = ctypes.string_at(data.value, nitems.value * width)
            return raw.decode("utf-8", "replace").rstrip("\x00")
        finally:
            if data.value:
                lib.XFree(data)

    def set(self, value):
        """Replace the property with `value` ("" clears it). False on failure."""
        lib = self._lib
        atom = lib.XInternAtom(self.conn, EFFECT_PROPERTY.encode(), False)
        if not atom:
            return False
        # xprop writes 8-bit STRING for this property and Gamescope accepts it;
        # match that rather than inventing a type Gamescope has never seen.
        string_type = lib.XInternAtom(self.conn, b"STRING", False)
        if not string_type:
            return False
        raw = value.encode("utf-8")
        buf = ctypes.create_string_buffer(raw, max(len(raw), 1))
        lib.XChangeProperty(
            self.conn, self.root, atom, string_type, 8, 0,  # 0 = PropModeReplace
            ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)), len(raw))
        lib.XSync(self.conn, False)
        return True


def read_effect(display):
    """The live effect path on `display`; "" when nothing is applied; None when
    the question could not be asked."""
    try:
        conn = _Connection(display)
    except X11Unavailable:
        return None
    try:
        return conn.get()
    finally:
        conn.close()


def write_effect(display, value):
    """Set the effect property. False means the write did not happen."""
    try:
        conn = _Connection(display)
    except X11Unavailable:
        return False
    try:
        return conn.set(value)
    finally:
        conn.close()


def property_present(display):
    """Whether `display` is a Gamescope X server, i.e. carries the property.

    None when the display cannot be asked, which the caller must not read as
    "no".
    """
    try:
        conn = _Connection(display)
    except X11Unavailable:
        return None
    try:
        return conn.has_property()
    finally:
        conn.close()


def describe(display=None):
    """One line for the diagnostics report, never raising."""
    if not available():
        return "libX11 not loadable"
    try:
        conn = _Connection(display)
    except X11Unavailable as e:
        return f"unavailable ({e})"
    try:
        value = conn.get()
        return ("readable, property " + ("present" if value else "empty")
                if value is not None else "unreadable")
    finally:
        conn.close()
