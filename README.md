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

The current QAM interface offers one **Filter mode** selector:

- **Off** disables the system-wide filter and removes DeckyCRT's wrapper from
  the active game's Steam launch options.
- **Active app** adds a nested Gamescope/ReShade wrapper to the foreground
  game's launch options: `gamescope --reshade-effect <shader-path> -- ...`.
  This changes saved launch options; it may require restarting the game and is
  still being tested across app changes and panel reloads.
- **System-wide** applies the filter to the entire Gamescope session, including
  Steam. It requires `xprop` and an accessible Gamescope display.

The two filter paths should not stack. Active-app detection and cleanup of
wrappers saved for apps that are no longer running still need testing. Preset
and slider values are saved, but a running per-game Gamescope instance may keep
using its already-loaded shader until the game restarts. Treat that behavior as
unverified until confirmed on the BC-250.

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

## Requirements / notes

- Your Gamescope build must include ReShade support
  (`gamescope --help | grep -i reshade`). The panel shows the detected
  status. If it's missing, per-game/global modes can't work — vkBasalt
  (`ENABLE_VKBASALT=1`, Vulkan games only) is the fallback path.
- System-wide mode needs `xprop` and a reachable Gamescope display. Active-app
  mode depends on Steam exposing foreground-app and launch-option APIs.
- Shaders live in `~/.local/share/gamescope/reshade/Shaders/deckycrt/`;
  config in `~/.config/deckycrt/config.json`. Nothing touches the
  read-only system image.
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

Then zip `plugin.json`, `package.json`, `main.py`, `dist/`, `shaders/`,
`community/`, `README.md` and `LICENSE` and install the zip via Decky's
Developer menu.

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

That runs the Python syntax check, `tsc --noEmit` (a real gate — it must be
silent), the frontend build, a check that the freshly built bundle contains the
code just written, and a rebuild to confirm the bundle is byte-reproducible.

The parts that cannot be checked off-device, and how to do them on the BC-250:

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
  Check the real list, not a guess: assert `min <= default <= max`, `step > 0`,
  and the same for any stored value in `~/.config/deckycrt/config.json`.

## Uninstall

Remove via Decky's plugin settings. Before uninstalling, set Filter mode to
**Off** while each wrapped game is available, then verify its Steam launch
options no longer include DeckyCRT's wrapper. Cleanup of wrappers for apps that
are no longer discoverable is not yet guaranteed. Delete
`~/.local/share/gamescope/reshade/Shaders/deckycrt*` and
`~/.config/deckycrt` to fully clean up.
