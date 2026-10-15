#!/usr/bin/env python3
"""Drive the DeckyCRT backend without the Decky UI.

The panel only runs inside Steam, so the backend is exercised here the way the
loader runs it: a stubbed `decky` module, the plugin dir on sys.path, and a
throwaway DECKY_USER_HOME so nothing touches the real ~/.config/deckycrt.

Everything that asks the system a question goes through the probe module, so
these tests hand the plugin a scripted adapter (`FakeProbe`) instead of
assigning private members. That is what makes the failure paths testable: a
probe that cannot answer is now a case the plugin must handle, not a case the
harness hides.

Covers the parts the frontend depends on:
  - the managed-app registry (the only way Off / System-wide can find a wrapper
    after the game exits)
  - the slider data contract: every param of every preset must satisfy
    min <= default <= max and step > 0, because a SliderField with an
    out-of-range value takes the whole panel down
  - install_shaders + get_status on a clean home
  - the fail-closed rule on every probe: an unanswerable question is reported
    as a failure, never as an empty answer
  - the production probe adapter's own failure handling (timeouts, nonzero
    exits, a missing binary)

Run: python3 scripts/test-backend.py
"""

import asyncio
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import types

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

failures = 0


def check(name, actual, expected):
    global failures
    if actual == expected:
        print(f"   ok   {name}")
    else:
        failures += 1
        print(f"   FAIL {name}\n        expected {expected!r}\n        actual   {actual!r}")


def load_plugin(home):
    decky = types.ModuleType("decky")

    def _log(fmt, *args):
        if args:
            try:
                fmt = fmt % args
            except TypeError:
                pass
        print("        [decky]", fmt)

    decky.logger = types.SimpleNamespace(
        info=_log, error=_log, warning=_log, debug=_log, critical=_log
    )
    decky.DECKY_USER_HOME = home
    decky.DECKY_HOME = os.path.join(home, "homebrew")
    sys.modules["decky"] = decky
    sys.path.insert(0, PLUGIN_DIR)
    spec = importlib.util.spec_from_file_location(
        "deckycrt_main", os.path.join(PLUGIN_DIR, "main.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    home = tempfile.mkdtemp(prefix="deckycrt-test-home-")
    mod = load_plugin(home)
    probe_mod = sys.modules["deckycrt_probe"]
    SystemProbe = probe_mod.SystemProbe
    core_row = ("Tue 2026-10-13 19:03:11 ADT 23952 1000 1000 SIGSEGV "
                "inaccessible /usr/bin/gamescope -")
    session_row = ("Tue 2026-10-13 18:20:00 ADT 4674 1000 1000 SIGABRT "
                   "missing /usr/bin/gamescope -")
    wrapped_cmd = (
        "gamescope --reshade-effect deckycrt-community/rsretroarch/Shaders/"
        "CRTLottes2.fx -- /usr/bin/steam-launch-wrapper -- /usr/bin/reaper "
        "SteamLaunch AppId=1337520 -- /usr/bin/proton waitforexitandrun "
        "/games/Risk of Rain Returns.exe")

    class FakeProbe:
        """The test adapter: scripted answers, the same methods as SystemProbe.

        `effect_stale` models Gamescope's render lag: an xprop write only
        becomes visible on the next composited frame, so a single immediate
        readback makes a successful toggle look like a no-op and invites the
        second press that stacks a filter.
        """

        def __init__(self):
            self.displays_result = mod.Ok([":0"])
            self.effect = mod.Ok("")
            self.effect_stale = 0
            self.writes = []
            self.running = mod.Ok([])
            self.cores = mod.Ok([])
            self.cmdlines = {}
            self.reshade = mod.Ok(True)
            self.core_since = None

        # -- the probe interface main.py depends on
        def displays(self):
            return self.displays_result

        def read_effect(self, display):
            if isinstance(self.effect, mod.Unknown):
                return self.effect
            if self.effect_stale > 0:
                self.effect_stale -= 1
                return mod.Ok("")
            return self.effect

        def write_effect(self, display, value):
            self.writes.append(value)
            self.effect = mod.Ok(value)
            self.effect_stale = 1
            return mod.Ok(None)

        def running_wrapped_apps(self):
            return self.running

        def core_dumps(self, since):
            self.core_since = since
            return self.cores

        def core_cmdline(self, pid):
            return self.cmdlines.get(str(pid),
                                     mod.Unknown(f"no record for {pid}"))

        def reshade_supported(self):
            return self.reshade

        def gamescope_version(self):
            return mod.Ok("gamescope version 3.16.31-ogc2+ (test)")

        def effect_access(self):
            return "x11"

        def crash_guard_available(self):
            return True

    probe = FakeProbe()
    plugin = mod.Plugin(probe=probe)
    run = asyncio.run

    print("backend: shaders + status")
    probe.displays_result = mod.Ok([":0"])
    probe.effect = mod.Unknown("xprop: unable to open display :0")
    check("failed live read stays unknown in status",
          run(plugin.get_status())["global_enabled"], None)
    probe.effect = mod.Ok("")
    check("install_shaders succeeds", run(plugin.install_shaders()), True)
    status = run(plugin.get_status())
    check("status reports shaders installed", status["shaders_installed"], True)
    check("status starts with no managed apps", status["managed_apps"], {})
    check("status exposes presets", len(status["presets"]) > 10, True)

    print("backend: slider data contract (all presets + stored params)")
    bad = []
    for preset in status["presets"]:
        for p in preset.get("params") or []:
            lo, hi, dflt, step = p.get("min"), p.get("max"), p.get("default"), p.get("step")
            if not all(isinstance(v, (int, float)) and math.isfinite(v)
                       for v in (lo, hi, dflt, step)):
                bad.append((preset["id"], p.get("key"), "non-finite"))
                continue
            if not (lo <= dflt <= hi):
                bad.append((preset["id"], p["key"], f"default {dflt} outside [{lo}, {hi}]"))
            if not (0 < step <= hi - lo):
                bad.append((preset["id"], p["key"], f"step {step} vs span {hi - lo}"))
    check("every param is representable as a slider", bad, [])

    print("backend: managed-app registry")
    app_id = 1337520
    res = run(plugin.set_managed_app(app_id, "Risk of Rain Returns",
                                     "deckycrt/aperture-grille.fx", True, True))
    check("register returns ok", res["ok"], True)
    status = run(plugin.get_status())
    check("registry lists the game",
          status["managed_apps"].get(str(app_id), {}).get("name"),
          "Risk of Rain Returns")
    check("registry remembers added %command%",
          status["managed_apps"].get(str(app_id), {}).get("added_command"), True)
    check("registry remembers the shader path",
          status["managed_apps"].get(str(app_id), {}).get("relpath"),
          "deckycrt/aperture-grille.fx")

    # The registry must survive a plugin reload: it is the on-disk record.
    reloaded = mod.Plugin(probe=probe)
    check("registry is persisted to config.json",
          run(reloaded.get_status())["managed_apps"].get(str(app_id), {}).get("name"),
          "Risk of Rain Returns")

    # A preset change re-points the stored path.
    run(plugin.set_managed_app(app_id, "Risk of Rain Returns",
                               "deckycrt/slot-mask.fx", True, True))
    check("re-pointing updates the stored path",
          run(plugin.get_status())["managed_apps"][str(app_id)]["relpath"],
          "deckycrt/slot-mask.fx")

    run(plugin.set_managed_app(app_id, "Risk of Rain Returns",
                               "deckycrt/slot-mask.fx", False, False))
    check("unregister removes the entry",
          run(plugin.get_status())["managed_apps"], {})

    for bad_id in (0, None, "not-an-id"):
        res = run(plugin.set_managed_app(bad_id, "x", "y", True, False))
        check(f"invalid app id {bad_id!r} is refused", res["ok"], False)

    run(plugin.set_managed_app(999, "A", "deckycrt/a.fx", True, False))
    run(plugin.set_managed_app(1000, "B", "deckycrt/a.fx", True, False))
    check("two games can be tracked at once",
          len(run(plugin.get_status())["managed_apps"]), 2)
    check("clear_managed_apps empties the registry",
          (run(plugin.clear_managed_apps()), run(plugin.get_status())["managed_apps"])[1], {})

    print("backend: Gamescope property output parser")
    parse = mod.Plugin._parse_effect_property
    check("parses xprop -notype effect path",
          parse('GAMESCOPE_RESHADE_EFFECT = "/path/to/crt.fx"'),
          (True, "/path/to/crt.fx"))
    check("parses typed effect path",
          parse('GAMESCOPE_RESHADE_EFFECT(STRING) = "/path/to/crt.fx"'),
          (True, "/path/to/crt.fx"))
    check("parses empty xprop value without quotes",
          parse("GAMESCOPE_RESHADE_EFFECT(STRING) = "), (True, ""))
    check("parses empty xprop value with quotes",
          parse('GAMESCOPE_RESHADE_EFFECT(STRING) = ""'), (True, ""))
    check("recognizes absent X atom",
          parse("GAMESCOPE_RESHADE_EFFECT:  no such atom on any window."),
          (True, ""))
    check("unknown output containing fx fails closed",
          parse("unexpected .fx output"), (False, ""))
    check("unrelated output fails closed", parse("xprop: unable to open display"),
          (False, ""))

    print("backend: crash detection parsers")
    # The real coredumpctl rows and command line that this was written against:
    # the per-game wrapper that took gamescope down when Risk of Rain Returns
    # was launched.
    check("core row yields its pid", mod.Plugin._parse_core_line(core_row), "23952")
    check("a non-core row yields nothing",
          mod.Plugin._parse_core_line("No coredumps found."), None)
    check("session gamescope core still yields its pid",
          mod.Plugin._parse_core_line(session_row), "4674")
    check("wrapper command line yields the app id",
          mod.Plugin._wrapper_appid_from_cmdline(wrapped_cmd), 1337520)
    check("the session compositor is not one of our wrappers",
          mod.Plugin._wrapper_appid_from_cmdline(
              "/usr/bin/gamescope --touch-gestures --prefer-output *,eDP-1"), None)
    check("another plugin's reshade wrapper is not ours",
          mod.Plugin._wrapper_appid_from_cmdline(
              "gamescope --reshade-effect /usr/share/other/x.fx -- "
              "SteamLaunch AppId=123"), None)

    print("backend: crash scan fails closed")
    # A game the scan can actually find: the registry is what ties a core to a
    # wrapper we installed.
    run(plugin.set_managed_app(app_id, "Risk of Rain Returns",
                               "deckycrt/aperture-grille.fx", True, True))

    probe.cores = mod.Unknown("coredumpctl list exited 1: denied")
    res = run(plugin.check_wrapper_crashes())
    check("a scan that could not run is not 'no crashes'", res["ok"], False)
    check("the failure says why", "denied" in res["detail"], True)
    check("a failed scan reports no crashes", res["crashes"], [])

    # An unnamed core must not be recorded as seen, or it is never looked at
    # again and the game stays unlaunchable.
    probe.cores = mod.Ok(["23952"])
    probe.cmdlines = {}
    res = run(plugin.check_wrapper_crashes())
    check("an unnamed core is not reported as a crash", res["crashes"], [])
    check("an unnamed core is not marked seen",
          "23952" in (plugin._load_config().get("crash_scan_seen") or []), False)

    probe.cmdlines = {"23952": mod.Ok(wrapped_cmd)}
    res = run(plugin.check_wrapper_crashes())
    check("a named core for a managed game is reported",
          [c["app_id"] for c in res["crashes"]], [1337520])
    check("a named core carries the game name",
          res["crashes"][0]["name"], "Risk of Rain Returns")
    check("a classified core is marked seen",
          "23952" in (plugin._load_config().get("crash_scan_seen") or []), True)
    check("a seen core is not reported twice",
          run(plugin.check_wrapper_crashes())["crashes"], [])
    check("the scan asks for 3 days of cores", probe.core_since, "3 days ago")

    print("probe: children get a clean loader environment")
    # Decky's bundled Python leaks LD_LIBRARY_PATH into every child process, so
    # system binaries fail to start: coredumpctl died loading the bundle's
    # libcrypto, which turned the crash guard into "unknown" — the one path that
    # decides whether a game can still launch.
    probe_mod = importlib.import_module("deckycrt_probe")
    saved = {k: os.environ.get(k) for k in probe_mod.LEAKY_ENV_VARS}
    os.environ["LD_LIBRARY_PATH"] = "/tmp/deckycrt-poison"
    os.environ["LD_PRELOAD"] = "/tmp/deckycrt-poison/libx.so"
    os.environ["DECKYCRT_TEST_KEEP"] = "kept"
    try:
        env = probe_mod.child_env()
        check("the bundle's library path is stripped",
              env.get("LD_LIBRARY_PATH"), None)
        check("the preload is stripped", env.get("LD_PRELOAD"), None)
        check("nothing else is dropped", env.get("DECKYCRT_TEST_KEEP"), "kept")
        out = probe_mod.run_child(["env"], capture_output=True, text=True).stdout
        check("a real child sees no LD_LIBRARY_PATH",
              "LD_LIBRARY_PATH=" in out, False)
        check("a real child still sees the environment",
              "DECKYCRT_TEST_KEEP=kept" in out, True)
        check("the probe's default runner is the sanitizing one",
              probe_mod.SystemProbe()._run, probe_mod.run_child)
    finally:
        for name in probe_mod.LEAKY_ENV_VARS:
            os.environ.pop(name, None)
        os.environ.pop("DECKYCRT_TEST_KEEP", None)
        for name, value in saved.items():
            if value is not None:
                os.environ[name] = value

    print("backend: wrapped-app probe failures fail closed")
    probe.running = mod.Unknown("ps timed out after 10 seconds")
    res = run(plugin.wrapped_running_apps())
    check("a timeout returns probe failure", res["ok"], False)
    check("a timeout includes no guessed app IDs", res["app_ids"], [])
    probe.running = mod.Unknown("ps exited 1: denied")
    check("nonzero ps returns probe failure",
          run(plugin.wrapped_running_apps())["ok"], False)
    probe.running = mod.Ok([1337520])
    res = run(plugin.wrapped_running_apps())
    check("an answered probe reports its app ids",
          (res["ok"], res["app_ids"]), (True, [1337520]))
    probe.running = mod.Ok([])

    print("backend: global-effect transitions")
    probe.writes.clear()
    probe.displays_result = mod.Ok([":0"])
    probe.effect = mod.Ok("")
    probe.effect_stale = 1

    res = run(plugin.set_global_enabled(True))
    check("enable survives a stale first read", res["ok"], True)
    check("enable records confirmed live state",
          plugin._load_config()["global_enabled"], True)
    check("enable writes the property once", len(probe.writes), 1)

    res = run(plugin.set_global_enabled(True))
    check("repeating the same mode is idempotent", res["ok"], True)
    check("repeat does not re-write the property", len(probe.writes), 1)

    res = run(plugin.set_global_enabled(False))
    check("disable survives a stale first read", res["ok"], True)
    check("disable records confirmed off state",
          plugin._load_config()["global_enabled"], False)
    check("disable writes an empty property", probe.writes[-1], "")

    res = run(plugin.set_global_enabled(False))
    check("repeating Off is idempotent", res["ok"], True)
    check("repeat Off does not re-write", len(probe.writes), 2)

    # An unreadable property must fail closed: never guess and write.
    probe.effect = mod.Unknown("xprop: unable to open display :0")
    before = list(probe.writes)
    res = run(plugin.set_global_enabled(True))
    check("unreadable live state refuses the change", res["ok"], False)
    check("unreadable live state writes nothing", probe.writes, before)
    probe.effect = mod.Ok("")

    # A display list we cannot establish is another unanswerable question.
    probe.displays_result = mod.Unknown("no X server socket found")
    before = list(probe.writes)
    probe.effect = mod.Ok("deckycrt/aperture-grille.fx")
    res = run(plugin.set_global_enabled(True))
    check("no reachable display refuses the change", res["ok"], False)
    check("no reachable display writes nothing", probe.writes, before)
    probe.displays_result = mod.Ok([":0"])

    # A write that fails is not a success.
    probe.effect = mod.Ok("")
    before = list(probe.writes)
    probe.write_effect = lambda display, value: mod.Unknown("xprop -set failed")
    res = run(plugin.set_global_enabled(True))
    check("a failed property write refuses the change", res["ok"], False)
    check("a failed property write changes nothing", probe.writes, before)
    probe.write_effect = FakeProbe.write_effect.__get__(probe)

    # A slider event queued while Off must not resurrect the filter.
    status_now = run(plugin.get_status())
    preset_aperture = next(p for p in status_now["presets"]
                           if p["id"] == "aperture-grille")
    keys = [p["key"] for p in (preset_aperture.get("params") or [])]
    before = list(probe.writes)
    if keys:
        res = run(plugin.set_param("aperture-grille", keys[0], 0.5,
                                   reapply=True))
        check("a slider change is accepted", res["ok"], True)
        check("slider while Off writes no property", probe.writes, before)
    else:
        check("aperture-grille exposes at least one slider param",
              keys, ["<none>"])

    print("backend: the production probe adapter")
    # The adapter's own failure handling, driven through its internal `run`,
    # `which` and `x11` rather than by assigning module globals. X is stubbed
    # as unavailable here so these cases never touch a live X server.
    always_which = lambda name: "/usr/bin/" + name
    no_which = lambda name: None
    no_x11 = types.SimpleNamespace(available=lambda: False)

    def timed_out_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 10)

    check("a missing coredumpctl is an answer, not unknown",
          SystemProbe(run=timed_out_run, which=no_which, x11=no_x11)
          .core_dumps("3 days ago"), mod.Ok([]))
    check("a timed-out ps is Unknown, not an empty list",
          isinstance(SystemProbe(run=timed_out_run, which=always_which, x11=no_x11)
                     .running_wrapped_apps(), mod.Unknown), True)
    check("a failed coredumpctl list is Unknown",
          isinstance(SystemProbe(
              run=lambda *a, **k: subprocess.CompletedProcess(a[0], 1, "", "denied"),
              which=always_which, x11=no_x11).core_dumps("3 days ago"), mod.Unknown), True)
    check("gamescope with no reshade support is a real answer",
          SystemProbe(
              run=lambda *a, **k: subprocess.CompletedProcess(a[0], 0, "usage: gamescope", ""),
              which=always_which, x11=no_x11).reshade_supported(), mod.Ok(False))
    check("a missing gamescope binary is a real answer",
          SystemProbe(run=timed_out_run, which=no_which, x11=no_x11)
          .reshade_supported(), mod.Ok(False))
    check("a gamescope --help that cannot run is Unknown",
          isinstance(SystemProbe(run=timed_out_run, which=always_which, x11=no_x11)
                     .reshade_supported(), mod.Unknown), True)
    check("a ps listing is parsed into app ids",
          SystemProbe(
              run=lambda *a, **k: subprocess.CompletedProcess(a[0], 0, wrapped_cmd + "\n", ""),
              which=always_which, x11=no_x11).running_wrapped_apps(), mod.Ok([1337520]))
    check("the gamescope build string is reported",
          SystemProbe(run=lambda *a, **k: subprocess.CompletedProcess(
              a[0], 0, "gamescope version 3.16.31-ogc2+ (gcc 16.2.1)\n", ""),
              which=always_which, x11=no_x11).gamescope_version(),
          mod.Ok("gamescope version 3.16.31-ogc2+ (gcc 16.2.1)"))
    check("the plugin's default probe is the production adapter",
          isinstance(mod.Plugin().probe, SystemProbe), True)
    check("running-wrapper probe returns a list",
          isinstance(run(mod.Plugin().wrapped_running_apps()).get("app_ids"), list), True)

    print("backend: reaching the effect property without xprop")
    # The plugin must not need a binary the host may not install, so it talks to
    # X itself; xprop is only the fallback for a host whose libX11 will not load.

    class ScriptedX11:
        """The in-process X adapter, scripted: what the probe is told to
        believe about availability, presence and reads."""

        def __init__(self, available=True, present=(":0",), value=""):
            self._available = available
            self._present = set(present)
            self._value = value
            self.writes = []

        def available(self):
            return self._available

        def property_present(self, display):
            return (display in self._present) if self._available else None

        def read_effect(self, display):
            return self._value

        def write_effect(self, display, value):
            self.writes.append((display, value))
            self._value = value
            return True

        @staticmethod
        def describe(display=None):
            return "scripted"

    # Two X servers on the machine, only one of them Gamescope's: the probe
    # must return just that one, whatever the host it runs on happens to have.
    x11 = ScriptedX11(value="deckycrt/crt.fx")
    probe_x11 = SystemProbe(which=no_which, x11=x11, sockets=[":0", ":1"])
    check("with libX11 the mechanism is in-process X",
          probe_x11.effect_access(), "x11")
    check("the property is read in-process",
          probe_x11.read_effect(":0"), mod.Ok("deckycrt/crt.fx"))
    check("the property is written in-process",
          (probe_x11.write_effect(":0", "other.fx"), x11.writes),
          (mod.Ok(None), [(":0", "other.fx")]))
    check("only the display carrying the property is discovered",
          probe_x11.displays(), mod.Ok([":0"]))
    check("a machine with no X sockets is Unknown, not an empty list",
          isinstance(SystemProbe(which=no_which, x11=x11, sockets=[]).displays(),
                     mod.Unknown), True)

    xprop_run = lambda *a, **k: subprocess.CompletedProcess(
        a[0], 0, 'GAMESCOPE_RESHADE_EFFECT(STRING) = "deckycrt/x.fx"', "")
    probe_xprop = SystemProbe(run=xprop_run, which=always_which, x11=no_x11)
    check("without libX11 it falls back to the xprop binary",
          probe_xprop.effect_access(), "xprop")
    check("the fallback still reads the property",
          probe_xprop.read_effect(":0"), mod.Ok("deckycrt/x.fx"))

    def missing_binary_run(*args, **kwargs):
        raise FileNotFoundError("xprop")

    probe_none = SystemProbe(run=missing_binary_run, which=no_which, x11=no_x11)
    check("with neither, the plugin says so instead of pretending",
          probe_none.effect_access(), "none")
    check("with neither, a read is Unknown not empty",
          isinstance(probe_none.read_effect(":0"), mod.Unknown), True)

    print("backend: the in-process X module itself")
    # Only the no-server paths are hermetic; the live ones are checked on the
    # device by scripts/test-x11-live.py and by the panel test.
    x11mod = sys.modules.get("deckycrt_x11")
    check("the X module is shipped and loadable", x11mod is not None, True)
    if x11mod is not None:
        check("libX11 is loadable on this machine", x11mod.available(), True)
        check("a display that does not exist reads as unknown",
              x11mod.read_effect(":12345"), None)
        check("a display that does not exist cannot be written",
              x11mod.write_effect(":12345", "x"), False)
        check("a display that does not exist is not a Gamescope display",
              x11mod.property_present(":12345"), None)

    print("backend: diagnostics for a setup nobody has tested")
    diag = run(plugin.get_diagnostics())
    labels = {r["label"]: r["value"] for r in diag["rows"]}
    check("diagnostics return ok", diag["ok"], True)
    for needed in ("plugin_version", "effect_access", "libx11", "xprop_binary",
                   "displays", "live_effect", "shader_dir_user",
                   "coredumpctl", "ps", "gamescope_version", "session_type"):
        check(f"diagnostics report {needed}", needed in labels, True)
    check("diagnostics name the mechanism in use",
          labels["effect_access"], "x11")
    check("diagnostics name the shader dir gamescope searches",
          labels["shader_dir_user"].endswith("gamescope/reshade/Shaders"), True)

    print("backend: config file on disk")
    cfg_path = os.path.join(home, ".config", "deckycrt", "config.json")
    check("config.json exists", os.path.isfile(cfg_path), True)
    with open(cfg_path, encoding="utf-8") as f:
        on_disk = json.load(f)
    check("config.json carries the registry key", "managed_apps" in on_disk, True)

    if failures:
        print(f"\n{failures} failure(s)")
        return 1
    print("\nbackend harness: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
