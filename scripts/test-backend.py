#!/usr/bin/env python3
"""Drive the DeckyCRT backend without the Decky UI.

The panel only runs inside Steam, so the backend is exercised here the way the
loader runs it: a stubbed `decky` module, the plugin dir on sys.path, and a
throwaway DECKY_USER_HOME so nothing touches the real ~/.config/deckycrt.

Covers the parts the frontend depends on:
  - the managed-app registry (the only way Off / System-wide can find a wrapper
    after the game exits)
  - the slider data contract: every param of every preset must satisfy
    min <= default <= max and step > 0, because a SliderField with an
    out-of-range value takes the whole panel down
  - install_shaders + get_status on a clean home

Run: python3 scripts/test-backend.py
"""

import asyncio
import importlib.util
import json
import math
import os
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
    plugin = mod.Plugin()
    run = asyncio.run

    print("backend: shaders + status")
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
    reloaded = mod.Plugin()
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

    print("backend: global-effect transitions")
    # xprop's write only becomes visible after Gamescope's next render tick, so a
    # single immediate readback makes a successful toggle look like a no-op and
    # invites the second press that stacks a filter. These stubs model that lag.
    saved = {
        "displays": plugin._gamescope_displays,
        "xprop": plugin._xprop,
        "which": mod.shutil.which,
        "sleep": mod.asyncio.sleep,
        "preset": plugin._preset_by_id,
        "resolve": plugin._resolve_relpath,
    }
    writes = []
    live = {"value": "", "stale": 1, "readable": True}

    def fake_xprop(display, *args):
        if "-set" in args:
            writes.append(args[-1])
            live["value"] = args[-1]
            live["stale"] = 1
            return 0, ""
        if args[-1] == "GAMESCOPE_RESHADE_EFFECT":
            if not live["readable"]:
                return 1, "xprop: unable to open display :0"
            stale, live["stale"] = live["stale"], max(0, live["stale"] - 1)
            shown = "" if stale > 0 else live["value"]
            return 0, f'GAMESCOPE_RESHADE_EFFECT(STRING) = "{shown}"'
        return 0, ""

    async def no_wait(_seconds):
        return None

    try:
        plugin._gamescope_displays = lambda: [":0"]
        plugin._xprop = fake_xprop
        plugin._preset_by_id = lambda pid, cfg: {
            "id": pid, "name": "Test CRT", "heavy": False, "relpath": "",
            "file": "", "params": []}
        plugin._resolve_relpath = lambda preset, cfg: "deckycrt/crt.fx"
        mod.shutil.which = (lambda name: "/usr/bin/xprop"
                            if name == "xprop" else None)
        mod.asyncio.sleep = no_wait

        res = run(plugin.set_global_enabled(True))
        check("enable survives a stale first read", res["ok"], True)
        check("enable records confirmed live state",
              plugin._load_config()["global_enabled"], True)
        check("enable writes the property once", len(writes), 1)

        res = run(plugin.set_global_enabled(True))
        check("repeating the same mode is idempotent", res["ok"], True)
        check("repeat does not re-write the property", len(writes), 1)

        res = run(plugin.set_global_enabled(False))
        check("disable survives a stale first read", res["ok"], True)
        check("disable records confirmed off state",
              plugin._load_config()["global_enabled"], False)
        check("disable writes an empty property", writes[-1], "")

        res = run(plugin.set_global_enabled(False))
        check("repeating Off is idempotent", res["ok"], True)
        check("repeat Off does not re-write", len(writes), 2)

        # An unreadable property must fail closed: never guess and write.
        live["readable"] = False
        before = list(writes)
        res = run(plugin.set_global_enabled(True))
        check("unreadable live state refuses the change", res["ok"], False)
        check("unreadable live state writes nothing", writes, before)
        live["readable"] = True

        # A slider event queued while Off must not resurrect the filter.
        before = list(writes)
        res = run(plugin.set_param("aperture-grille", "scanline", 0.5,
                                   reapply=True))
        check("slider while Off writes no property", writes, before)
    finally:
        plugin._gamescope_displays = saved["displays"]
        plugin._xprop = saved["xprop"]
        plugin._preset_by_id = saved["preset"]
        plugin._resolve_relpath = saved["resolve"]
        mod.shutil.which = saved["which"]
        mod.asyncio.sleep = saved["sleep"]

    print("backend: crash detection parsers")
    # The real coredumpctl rows and command line that this was written against:
    # the per-game wrapper that took gamescope down when Risk of Rain Returns
    # was launched.
    core_row = ("Tue 2026-10-13 19:03:11 ADT 23952 1000 1000 SIGSEGV "
                "inaccessible /usr/bin/gamescope -")
    session_row = ("Tue 2026-10-13 18:20:00 ADT 4674 1000 1000 SIGABRT "
                   "missing /usr/bin/gamescope -")
    check("core row yields its pid", mod.Plugin._parse_core_line(core_row), "23952")
    check("a non-core row yields nothing",
          mod.Plugin._parse_core_line("No coredumps found."), None)
    check("session gamescope core still yields its pid",
          mod.Plugin._parse_core_line(session_row), "4674")

    wrapped_cmd = (
        "gamescope --reshade-effect deckycrt-community/rsretroarch/Shaders/"
        "CRTLottes2.fx -- /usr/bin/steam-launch-wrapper -- /usr/bin/reaper "
        "SteamLaunch AppId=1337520 -- /usr/bin/proton waitforexitandrun "
        "/games/Risk of Rain Returns.exe")
    check("wrapper command line yields the app id",
          mod.Plugin._wrapper_appid_from_cmdline(wrapped_cmd), 1337520)
    check("the session compositor is not one of our wrappers",
          mod.Plugin._wrapper_appid_from_cmdline(
              "/usr/bin/gamescope --touch-gestures --prefer-output *,eDP-1"), None)
    check("another plugin's reshade wrapper is not ours",
          mod.Plugin._wrapper_appid_from_cmdline(
              "gamescope --reshade-effect /usr/share/other/x.fx -- "
              "SteamLaunch AppId=123"), None)
    check("running-wrapper probe returns a list",
          isinstance(run(mod.Plugin().wrapped_running_apps()).get("app_ids"), list), True)

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
