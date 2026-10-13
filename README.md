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
`README.md` and `LICENSE` and install the zip via Decky's Developer menu.

## Uninstall

Remove via Decky's plugin settings. Your games' launch options are left
untouched except DeckyCRT's own wrapper, which the per-game toggle removes
when disabled. Delete `~/.local/share/gamescope/reshade/Shaders/deckycrt*`
and `~/.config/deckycrt` to fully clean up.
