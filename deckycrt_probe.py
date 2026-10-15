"""The one place that asks the system questions.

Every method returns a Result: `Ok(value)` when the system answered, or
`Unknown(reason)` when the question could not be asked. Unknown is not an
empty answer, and the difference decides real behaviour: reading the core
dump list as an empty list when coredumpctl failed made a scan that never
happened look exactly like "no crashes", on the one path that decides whether
a game can still launch.

`SystemProbe` is the production adapter: subprocess, and X via `deckycrt_x11`
(in-process, no binary required) with the `xprop` binary kept as a fallback for
hosts where libX11 is not loadable. Tests pass a scripted adapter with the same
method names, so the policy that sits above this line is exercised through one
interface instead of by assigning private members. `SystemProbe` takes its
`run`, `which` and `x11` as arguments for the same reason: its own failure
handling is testable without swapping globals.
"""

import os
import pwd
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Union

try:
    import deckycrt_x11
except ImportError:  # pragma: no cover - only if the module was not shipped
    deckycrt_x11 = None

# One timeout policy for every question this plugin asks a process. These were
# five separate literals scattered across the callers before.
PS_TIMEOUT = 10
COREDUMP_TIMEOUT = 25
XPROP_TIMEOUT = 10
GAMESCOPE_TIMEOUT = 15

PS_ARGS = ["ps", "-eo", "args"]
EFFECT_PROPERTY = "GAMESCOPE_RESHADE_EFFECT"


@dataclass(frozen=True)
class Ok:
    value: Any = None


@dataclass(frozen=True)
class Unknown:
    reason: str


Result = Union[Ok, Unknown]


# --------------------------------------------------------------------- parsers
# Pure, so they are tested directly and cannot hide a probe failure.


def parse_core_line(line: str) -> str | None:
    """PID from a `coredumpctl list` row, or None if it is not a core row.

    The timestamp has a variable number of words (weekday, date, time,
    timezone), so the PID is matched as the number preceding the three
    numeric columns that follow it, not by position.
    """
    m = re.search(r"\b(\d{1,7})\s+\d+\s+\d+\s+SIG[A-Z]+\b", line)
    return m.group(1) if m else None


def wrapper_appid_from_cmdline(cmdline: str) -> int | None:
    """App id when a gamescope command line is one of OUR per-game wrappers."""
    if "--reshade-effect" not in cmdline or "deckycrt" not in cmdline:
        return None
    m = re.search(r"AppId=(\d+)", cmdline)
    return int(m.group(1)) if m else None


def parse_effect_property(output: str) -> tuple[bool, str]:
    """Parse xprop output; distinguish empty from unreadable/unparseable."""
    if "no such atom" in output.lower():
        return True, ""
    # xprop -notype emits `NAME = "/path.fx"`; typed xprop emits
    # `NAME(STRING) = "/path.fx"`. Empty values appear as `NAME = ` or
    # `NAME(STRING) = ` (sometimes with quotes).
    match = re.search(
        r'GAMESCOPE_RESHADE_EFFECT(?:\([^)]*\))?\s*=\s*(?:"([^"]*)")?\s*$',
        output.strip(), re.IGNORECASE)
    if match:
        return True, match.group(1) or ""
    return False, ""


# ---------------------------------------------------------------------- probe


class SystemProbe:
    """The production adapter. Every method answers or reports Unknown."""

    def __init__(self, run=None, which=None, x11=None, sockets=None):
        self._run = run or subprocess.run
        self._which = which or shutil.which
        self._x11 = x11 if x11 is not None else deckycrt_x11
        # The X socket directory is a fact about the machine, so it is an
        # argument too: tests pin it instead of inheriting whatever the host
        # happens to have running.
        self._sockets = list(sockets) if sockets is not None else None

    def _x_sockets(self) -> Result:
        """The display names of the X servers this machine is running."""
        if self._sockets is not None:
            return Ok(list(self._sockets))
        sockets = []
        try:
            for name in os.listdir("/tmp/.X11-unix"):
                if name.startswith("X") and name[1:].isdigit():
                    sockets.append(":" + name[1:])
        except OSError as e:
            return Unknown(f"cannot list X sockets: {e}")
        return Ok(sockets)

    # -- processes

    def running_wrapped_apps(self) -> Result:
        """Apps running right now under our nested gamescope, or Unknown."""
        try:
            p = self._run(PS_ARGS, capture_output=True, text=True,
                          timeout=PS_TIMEOUT, check=False)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Unknown(f"ps failed: {e}")
        if p.returncode != 0:
            return Unknown(f"ps exited {p.returncode}: {(p.stderr or '')[:200]}")
        found = set()
        for line in (p.stdout or "").splitlines():
            app_id = wrapper_appid_from_cmdline(line)
            if app_id is not None:
                found.add(app_id)
        return Ok(sorted(found))

    # -- core dumps

    def core_dumps(self, since: str) -> Result:
        """PIDs of cores recorded since `since`, or Unknown.

        A missing coredumpctl is a real answer: there is nothing to read.
        A coredumpctl that fails is not.
        """
        if not self._which("coredumpctl"):
            return Ok([])
        try:
            p = self._run(["coredumpctl", "list", "--no-pager", "--since", since],
                          capture_output=True, text=True, timeout=COREDUMP_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Unknown(f"coredumpctl list failed: {e}")
        if p.returncode != 0:
            return Unknown(
                f"coredumpctl list exited {p.returncode}: {(p.stderr or '')[:200]}")
        pids = []
        for line in (p.stdout or "").splitlines():
            if "gamescope" not in line:
                continue
            pid = parse_core_line(line)
            if pid:
                pids.append(pid)
        return Ok(pids)

    def core_cmdline(self, pid: str) -> Result:
        """The command line recorded in a core, or Unknown."""
        if not self._which("coredumpctl"):
            return Unknown("coredumpctl is not installed")
        try:
            p = self._run(["coredumpctl", "info", pid, "--no-pager"],
                          capture_output=True, text=True, timeout=COREDUMP_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Unknown(f"coredumpctl info {pid} failed: {e}")
        if p.returncode != 0:
            return Unknown(f"coredumpctl info {pid} exited {p.returncode}")
        lines = (p.stdout or "").splitlines()
        for i, line in enumerate(lines):
            if "Command Line:" not in line:
                continue
            chunk = [line.split("Command Line:", 1)[1]]
            # The command line can wrap; stop at the next field.
            for nxt in lines[i + 1:]:
                if ":" in nxt and nxt.strip().split(":", 1)[0].isalpha():
                    break
                chunk.append(nxt)
            return Ok(" ".join(chunk))
        return Unknown(f"no Command Line field in the core for {pid}")

    # -- gamescope

    def reshade_supported(self) -> Result:
        """Whether this Gamescope build advertises ReShade support."""
        gs = self._which("gamescope")
        if not gs:
            return Ok(False)
        try:
            p = self._run([gs, "--help"], capture_output=True, text=True,
                          timeout=GAMESCOPE_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Unknown(f"gamescope --help failed: {e}")
        return Ok("reshade" in ((p.stdout or "") + (p.stderr or "")).lower())

    def xprop_installed(self) -> bool:
        return self._which("xprop") is not None

    def crash_guard_available(self) -> bool:
        """Whether the crash guard can run at all.

        It needs coredumpctl. When that is missing, `core_dumps()` correctly
        answers "nothing to read" — which is why the absence has to be reported
        separately, or the feature looks present and simply never fires.
        """
        return self._which("coredumpctl") is not None

    def gamescope_version(self) -> Result:
        """The gamescope build string.

        Portability reports need it: ReShade support and its behaviour differ
        between builds, and "it doesn't work" is unanswerable without knowing
        which compositor is running.
        """
        gs = self._which("gamescope")
        if not gs:
            return Unknown("gamescope is not installed")
        try:
            p = self._run([gs, "--version"], capture_output=True, text=True,
                          timeout=GAMESCOPE_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Unknown(f"gamescope --version failed: {e}")
        out = ((p.stdout or "") + (p.stderr or "")).strip()
        if not out:
            return Unknown("gamescope --version printed nothing")
        return Ok(out.splitlines()[0][:120])

    def displays(self) -> Result:
        """Displays that really carry Gamescope's reshade property.

        Other Xwayland servers in the same session open fine and answer
        questions, but have no GAMESCOPE_* property, so writing to them
        silently does nothing. Only Gamescope's own Xwayland counts.
        """
        listing = self._x_sockets()
        if isinstance(listing, Unknown):
            return listing
        sockets = listing.value
        if not sockets:
            return Unknown("no X server socket found")
        found = []
        unanswerable = 0
        x11 = self._x11_backend()
        for display in sockets:
            present = x11.property_present(display) if x11 is not None else None
            if present is None:
                # Fall back to the xprop binary for the yes/no question only.
                result = self._xprop(display, "-notype", EFFECT_PROPERTY)
                if isinstance(result, Unknown):
                    unanswerable += 1
                    continue
                rc, out = result.value
                present = rc == 0 and "not found" not in out
            if present:
                found.append(display)
        if found:
            return Ok(found)
        if unanswerable:
            return Unknown("no display could be asked about " + EFFECT_PROPERTY)
        return Unknown("no display carries " + EFFECT_PROPERTY)

    def effect_access(self) -> str:
        """How this plugin can reach the effect property: x11, xprop, or none.

        In-process X is the mechanism; xprop is the fallback for a host whose
        libX11 cannot be loaded. Which one is in use is a fact worth reporting,
        because "global mode unavailable" is otherwise indistinguishable from
        "this distro does not ship the utility we assumed".
        """
        if self._x11_usable():
            return "x11"
        if self._which("xprop"):
            return "xprop"
        return "none"

    def _x11_backend(self):
        """The in-process X module when it is usable, else None."""
        x11 = self._x11
        return x11 if (x11 and x11.available()) else None

    def _x11_usable(self) -> bool:
        return self._x11_backend() is not None

    def read_effect(self, display: str) -> Result:
        """The exact live effect path on one display, or Unknown."""
        x11 = self._x11_backend()
        if x11 is not None:
            value = x11.read_effect(display)
            if value is not None:
                return Ok(value)
            return Unknown(f"in-process X could not read {EFFECT_PROPERTY} "
                           f"on {display}")
        result = self._xprop(display, "-notype", EFFECT_PROPERTY)
        if isinstance(result, Unknown):
            return result
        rc, output = result.value
        if rc != 0:
            return Unknown(f"xprop failed on {display}: {output[:200]}")
        readable, effect = parse_effect_property(output)
        if not readable:
            return Unknown(f"unparseable property readback on {display}: "
                           f"{output[:200]}")
        return Ok(effect)

    def write_effect(self, display: str, value: str) -> Result:
        """Set the effect property to `value` and report the write itself.

        The write succeeding is not proof Gamescope took it: the caller reads
        back until the value is observed.
        """
        x11 = self._x11_backend()
        if x11 is not None:
            if x11.write_effect(display, value):
                return Ok(None)
            return Unknown(f"in-process X could not set {EFFECT_PROPERTY} "
                           f"on {display}")
        result = self._xprop(display, "-f", EFFECT_PROPERTY, "8s", "-set",
                            EFFECT_PROPERTY, value)
        if isinstance(result, Unknown):
            return result
        rc, output = result.value
        if rc != 0:
            return Unknown(f"xprop -set failed on {display}: {output[:200]}")
        return Ok(None)

    # -- internal

    def _xprop(self, display: str, *args: str) -> Result:
        env = dict(os.environ)
        env["DISPLAY"] = display
        cmd = ["xprop", "-root", *args]
        # Decky's loader runs as root; the session's X server only authorises
        # the session user, so run xprop as them (DISPLAY is set inside the
        # command because runuser resets the environment).
        if os.geteuid() == 0:
            owner = self._display_owner(display)
            if owner and owner != "root":
                cmd = ["runuser", "-u", owner, "--", "env",
                       f"DISPLAY={display}", *cmd]
        try:
            p = self._run(cmd, capture_output=True, text=True,
                          timeout=XPROP_TIMEOUT, env=env)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Unknown(f"xprop on {display} failed: {e}")
        return Ok((p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()))

    @staticmethod
    def _display_owner(display: str) -> str | None:
        """User that owns this X server's socket.

        The session's X server authorises the session user by local identity
        (SI:localuser:<user>) and there is typically no cookie file, so a
        root-owned process must run X clients as that same user.
        """
        num = display.lstrip(":") or "0"
        try:
            return pwd.getpwuid(
                os.stat(f"/tmp/.X11-unix/X{num}").st_uid).pw_name
        except (OSError, KeyError):
            return None
