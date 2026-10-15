# DeckyCRT

A Decky Loader plugin that applies CRT shaders on Bazzite (and other
Gamescope-based handheld setups) — either across your **whole screen** or
**per game**.

It works by driving Gamescope's built-in ReShade support
(`--reshade-effect`), so the filter is applied at the compositor level and
works with every game regardless of graphics API: Vulkan, OpenGL, Proton,
emulators, all of it.

## Install

1. Install Decky Loader on Bazzite: `ujust setup-decky` in a host terminal.
2. In Game Mode, open Decky (QAM) → Settings (gear) → Developer →
   **Install plugin from ZIP**, and pick `deckycrt.zip`.
3. Open the DeckyCRT panel from the QAM. It auto-installs its shaders on
   first load.

## Current test build

This is an in-progress build for hands-on testing, not a production-ready
release. The local source checkout, GitHub `main`, and the copy currently
installed on the BC-250 may not be identical. Confirm which build is installed
before reporting results.

The QAM interface offers one **Filter mode** selector, and the mode it shows is
derived from live state rather than from a separate flag:

- **Off** clears the whole-screen effect and removes DeckyCRT's wrapper from
  every game it knows about, running or not.
- **Active app** saves a Gamescope/ReShade wrapper in the foreground game's
  Steam launch options:
  `gamescope --reshade-effect <shader> -- %command%`. **It cannot filter a game
  that is already running** — the wrapper only takes effect at launch, so the
  panel says "applies the next time that game starts" instead of implying the
  running copy changed.
- **System-wide** applies the filter to the entire Gamescope session, including
  Steam. That necessarily includes whatever game is in the foreground; that is
  the point of the mode, not evidence that active-app mode worked.
- **Unknown** is not a mode but a reading: when Gamescope's live state (or the
  running game's launch options) could not be read, the selector says so
  instead of showing "Off". Changes that would add a filter are refused, and
  Off still works as the way out.

The two mechanisms must not stack, so switching between them clears the other
first and refuses the switch if the clear cannot be verified.

Wrapped games are recorded in the plugin config (`managed_apps`), because Steam
keeps the wrapper after the game exits — without that registry, Off and
System-wide could only ever clean up the app that happened to be in the
foreground. Changing preset re-points every tracked wrapper.

Launch options are read through `SteamClient.Apps.RegisterForAppDetails` and
written through `SteamClient.Apps.SetAppLaunchOptions`, with the write confirmed
by reading the value back. A read that fails returns "unknown" and nothing is
written — writing our wrapper on top of an unread value would erase the user's
real options. Beside it, the panel reports what it actually did in Steam's CEF
console (`DeckyCRT: …` lines), which is where a mode change that "does nothing"
leaves its evidence.

The proposed Low / Medium / High resource categories are not in the UI yet.
All bundled filters except CRT Pro are single-pass; CRT Pro is a two-pass
blur-plus-CRT effect. Community shaders and CRT-Royale have not been benchmarked
on the BC-250, so no FPS or resource-cost guarantee is implied.

## Usage notes

- **Presets** (15 built in): Scanlines, Aperture grille, Slot mask + curve,
  Slot mask (flat), Shadow mask, Green phosphor, Amber phosphor, B&W TV,
  Composite, Consumer TV, PVM, Arcade, Lottes, **CRT Pro** (bundled two-pass
  aperture grille with halation, beam profile, mask and curvature), and
  **CRT-Royale** (heavy, multi-pass; downloaded on demand, experimental).
- **Community packs**: one-tap downloads of curated ReShade shader collections
  (RSRetroArch and CRT-Guest). They are experimental and may not compile on
  every Gamescope build.

## Supported setups

The plugin needs a **Gamescope session with ReShade support**, and nothing else
from the host:

- **Gamescope with `--reshade-effect`.** Check it with
  `gamescope --help | grep -i reshade`; the panel reports what it finds. This
  landed upstream in September 2023 and shipped in **SteamOS 3.5+**, so a Steam
  Deck qualifies, as does Bazzite's deck image and any distro whose Gamescope
  includes it. Older or stripped builds cannot do per-game or system-wide mode —
  vkBasalt (`ENABLE_VKBASALT=1`, Vulkan games only) is the fallback there.
- **A Game Mode session for System-wide mode**, because that is what Gamescope
  is filtering. In desktop mode the per-game wrapper still works; it runs its own
  nested Gamescope.
- **Steam's launch-option APIs for Active app mode.** The panel says so when a
  Steam build does not expose them.
- **Shaders in `~/.local/share/gamescope/reshade/Shaders/deckycrt/`**, which is
  one of the two directories Gamescope documents in its own `--help`;
  config in `~/.config/deckycrt/config.json`. Nothing touches the read-only
  system image.

The plugin reaches Gamescope's effect property **in-process through libX11**, so
it does not need `xprop` installed. `xprop` is used only as a fallback where
libX11 cannot be loaded, and `coredumpctl` is optional: without it the crash
guard cannot run, and the panel says exactly that rather than appearing to work.

### If it doesn't work on your device

Open the panel and press **"Show and copy diagnostics"** under *This setup*.
That block is every capability the plugin depends on, answered by the machine
itself: the Gamescope build string, whether ReShade support was detected, which
mechanism reaches the effect property, which displays carry it, the live effect
value, the shader directories, and which helper binaries are present. One paste
is enough to identify what is missing on a setup nobody has tested yet.

## Requirements / notes

- System-wide mode needs a reachable Gamescope display. Active-app mode depends
  on Steam exposing foreground-app and launch-option APIs.
- Heavy CRT-Royale is fetched from the
  [vkBasalt-compat fork](https://github.com/andersstorhaug/crt-royale-reshade/tree/vkbasalt)
  of crt-royale-reshade at your request (large download, may be fragile
  under VRR).

## Build from source

```bash
git clone https://github.com/onewingmatt/CRTDECK
cd CRTDECK
pnpm install   # pnpm v9 required
pnpm run build # produces dist/index.js
```

Then zip `plugin.json`, `package.json`, `main.py`, `deckycrt_probe.py`,
`deckycrt_x11.py`, `dist/`, `shaders/`, `community/`, `README.md` and `LICENSE`
and install the zip via Decky's Developer menu.

`deckycrt_probe.py` and `deckycrt_x11.py` sit beside `main.py` and must ship with
it. The probe is the only place that asks the system a question (processes, core
dumps, Gamescope's property); the X module is the only place that talks to X.
`main.py` imports both by path, so a zip without them loads no backend at all.

`community/ReShade.fxh` is vendored into every pack's `Shaders/` directory on
install. Gamescope ships no ReShade headers and every community shader opens
with `#include "ReShade.fxh"`, so without it each one fails at line 1 with
"could not open included file" and the whole pack is dead weight. Packs already
installed get it added on the next plugin load.

## Verifying a change

Static checks (no device needed):

```bash
./scripts/verify.sh
```

That runs the Python syntax check, the launch-option unit tests
(`scripts/test-launch-options.ts`, plain `node` — the types are stripped by the
runtime), the filter-mode unit tests (`scripts/test-mode.ts`, which drives the
reading and the refusal rule in `src/mode.ts` with no renderer, no Steam and no
Gamescope), the backend harness (`scripts/test-backend.py`, which drives the
real `main.py` against a stubbed `decky` module, a scripted probe adapter and a
throwaway home, including the slider contract over the whole preset list),
`tsc --noEmit` (a real gate — it must be silent), the frontend build, a check
that the freshly built bundle contains the code just written, and a rebuild to
confirm the bundle is byte-reproducible.

The parts that cannot be checked off-device, and how to do them on the BC-250:

- **Does the panel's mode actually write launch options?** The panel logs every
  step to Steam's CEF console, so the answer is a grep, not a guess:
  `grep -a DeckyCRT ~/.steam/steam/logs/cef_log.txt | tail -20`.
  A successful "Active app" switch reads
  `DeckyCRT: launch options for 1337520 now "gamescope --reshade-effect … %command%"`.
  A failure says which seam it was on: `cannot read launch options`,
  `SetAppLaunchOptions unavailable`, or
  `Steam did not confirm launch options … read "…"` with both strings. Errors
  only appear while the panel is mounted, so reproduce by opening it.
- **Does Gamescope accept each shader?** It reports rejections in the journal,
  never in Decky's log:
  `journalctl --since '1 min ago' | grep gamescope_reshade`
  Success is `Using technique: <name>` + `Compiling pass:`. Failure is
  `Failed to parse reshade fx shader module: <path>(line, col): error Xnnnn`.
  A `Couldn't find texture with name: V__BackBufferTex` line is benign.
  Two traps: Gamescope only reloads the effect on a **new composited frame**
  (an idle screen can sit for 10+ seconds), and it **caches by path**
  (re-pointing at a path it already parsed logs nothing — use a fresh filename
  to force a parse). To force a frame rather than wait for one, change the
  Steam UI page — `steam steam://open/downloads`, alternating with another
  page so each launch is a change. Expect ~85% coverage per pass and retry the
  remainder; `xdotool mousemove` and `glxgears` both failed to produce frames.
- **Known limitation:** a handful of community shaders are rejected by
  Gamescope's compiler on upstream type diagnostics (`warning X3206: implicit
  truncation of vector type`, `warning X4576: ... semantic does not match
  vertex shader one`). Gamescope treats them as fatal, so those presets do
  nothing, and they cannot be fixed without editing the upstream shader. Of the
  75 shaders in the two packs, 61 compile on Gamescope 3.16.28-ogc3+ and 13 are
  rejected.
- **Does the panel's data contract hold?** The panel takes the whole plugin
  down if a preset hands it a slider whose `default` sits outside `[min, max]`.
  `scripts/test-backend.py` asserts that over the real list; the device-side
  version is the same check against `~/.config/deckycrt/config.json`, whose
  stored values are re-clamped by the backend on load.
- **Round-trip on a real game:** wrap a game, confirm the exact launch-options
  string in `~/.steam/steam/userdata/<id>/config/localconfig.vdf`, then set
  Filter mode to Off and confirm the original string is back — including the
  `%command%` the wrapper had to add for a game whose options had none.

## Uninstall

Remove via Decky's plugin settings. Before uninstalling, set Filter mode to
**Off**: that clears the whole-screen effect and strips the wrapper from every
game in the plugin's `managed_apps` registry, whether or not it is running. If
the panel reports that some wrappers could not be read or cleared, fix those
first — the game's launch options are the only copy. Then delete
`~/.local/share/gamescope/reshade/Shaders/deckycrt*` and `~/.config/deckycrt`
to fully clean up.
