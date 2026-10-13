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

## Usage

- **Global CRT (whole screen)**: one toggle. It sets the shader on the
  running Gamescope session, so every game *and* the Steam UI get the CRT
  look. No reboot needed; toggling back off restores the clean image.
  - Requires `xprop` and an X11 display in the session. The panel reports
    honestly if global mode isn't available on your setup.
  - Tip: if you use global mode, turn off any per-game CRT to avoid
    stacking two filters.
- **This game**: with a game running, the panel shows a per-game toggle.
  It wraps that game's Steam launch options in a nested Gamescope with the
  shader: `gamescope --reshade-effect <preset> -- <your options>`.
  Your original launch options are preserved and restored on disable.
- **Presets** (14 built in): Scanlines, Aperture grille, Slot mask + curve,
  Slot mask (flat), Shadow mask, Green phosphor, Amber phosphor, B&W TV,
  Composite, Consumer TV, PVM, Arcade, Lottes (all light, single-pass, with
  live sliders), plus CRT-Royale (heavy, multi-pass — downloaded on demand,
  experimental).
- **Community packs**: one-tap downloads of curated ReShade shader
  collections (RSRetroArch: Hyllian, Lottes, Geom, Caligari…; CRT-Guest
  ReShade). Downloaded shaders appear in the preset list with auto-detected
  sliders. Experimental — not every shader compiles on every Gamescope
  build.

## Requirements / notes

- Your Gamescope build must include ReShade support
  (`gamescope --help | grep -i reshade`). The panel shows the detected
  status. If it's missing, per-game/global modes can't work — vkBasalt
  (`ENABLE_VKBASALT=1`, Vulkan games only) is the fallback path.
- Global mode needs `xprop`. If it's absent on your Bazzite image, only
  per-game mode is offered.
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

Remove via Decky's plugin settings. Your games' launch options are left
untouched except DeckyCRT's own wrapper, which the per-game toggle removes
when disabled. Delete `~/.local/share/gamescope/reshade/Shaders/deckycrt*`
and `~/.config/deckycrt` to fully clean up.
