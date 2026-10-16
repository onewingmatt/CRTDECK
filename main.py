"""DeckyCRT backend.

Manages CRT shaders for Gamescope's --reshade-effect support:

- installs bundled light shaders to ~/.local/share/gamescope/reshade/Shaders/
- downloads the heavy CRT-Royale port on demand
- toggles a whole-screen ("global") shader on the running Gamescope session
  via the GAMESCOPE_RESHADE_EFFECT X11 root-window property
- bakes slider values into shader uniform initializers
- stores config in ~/.config/deckycrt/config.json

Per-game launch-option patching is done from the frontend via the Steam
client API (proven pattern); the backend only supplies shader paths.
"""

import asyncio
import json
import math
import os
import pwd
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile

import decky

# Decky loads main.py by path, so the sibling probe module is not guaranteed to
# be importable: put this file's directory on sys.path first.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from deckycrt_probe import (  # noqa: E402 - must follow the sys.path fix
    Ok,
    SystemProbe,
    Unknown,
    parse_core_line,
    parse_effect_property,
    wrapper_appid_from_cmdline,
)

try:  # noqa: E402 - same sys.path rule as the probe
    import deckycrt_x11
except ImportError:  # pragma: no cover - only if the module was not shipped
    deckycrt_x11 = None

PLUGIN_SLUG = "deckycrt"
CONFIG_PATH_REL = os.path.join(".config", PLUGIN_SLUG, "config.json")
# Gamescope resolves `--reshade-effect <path>` under these two dirs;
# the user-local one is where we install.
SHADER_BASE_REL = os.path.join(".local", "share", "gamescope", "reshade", "Shaders")
LIGHT_SUBDIR = "deckycrt"
HEAVY_SUBDIR = "deckycrt-heavy"
HEAVY_ZIP_URL = (
    "https://github.com/andersstorhaug/crt-royale-reshade"
    "/archive/refs/heads/vkbasalt.zip"
)
COMMUNITY_SUBDIR = "deckycrt-community"
COMMUNITY_HEADER = "ReShade.fxh"
# Every community shader opens with `#include "ReShade.fxh"`, and Gamescope
# ships no ReShade headers, so without this file every one of them fails at
# line 1 with "could not open included file". Bundled so packs install offline.
COMMUNITY_HEADER_URL = ("https://raw.githubusercontent.com/crosire/"
                        "reshade-shaders/master/Shaders/ReShade.fxh")
# Gamescope's compile verdict for every community shader, measured on this box
# (see community/verdicts.json). Shipped, not measured at runtime: the compiler
# is only reachable by applying a shader to a session, and doing that to find out
# which ones are dead is exactly the crash opportunity the plugin avoids.
VERDICT_PATH_REL = os.path.join("community", "verdicts.json")
# Bump when _parse_uniforms' range OR selection rules change: stored community
# params were derived by the old rules and would otherwise keep poisoning the
# panel.
PARAMS_REV = 3
# How many of a community shader's parameters the panel shows. CRT-Guest-Advanced
# declares 129; nobody wants 129 sliders in a couch UI, so the useful ones win.
COMMUNITY_PARAM_LIMIT = 24
# Which of a community shader's parameters the panel shows when it declares more
# than COMMUNITY_PARAM_LIMIT. A shader's OWN declaration order is not a priority
# order: CRT-Guest-Advanced declares 129 parameters and starts with persistence
# and 3D LUT selects, so the first ten it used to hand over were the ten that
# cannot work here (persistence needs the previous frame; the LUT selects need
# textures this plugin does not ship). Ten of those is what "CRT Pro doesn't have
# the options I'd like" looked like from the user's side.
#
# These groups ARE a priority order, matched on the label and the key, with the
# shader's own order kept inside each group. The inert list wins outright, so a
# substring can only ever downgrade a parameter: "Afterglow Strength" contains
# "glow" but is inert here, and "Interlacing Scanlines" contains "scanline" but
# needs a field sequence no panel produces.
_PARAM_GROUPS = (
    ("mask", ("shadow_msk", "maskstr", "masksize", "mask_zoom", "mshift",
              "mask_layout", "mask_drk", "mask_lgt", "mask_gamma", "grille",
              "slot", "phosphor", "aperture", "mask")),
    ("scanlines", ("scanline1", "scanline2", "beam_min", "beam_max",
                   "beam_size", "scangamma", "scan_falloff", "spike", "gsl",
                   "scanline", "beam")),
    ("glow", ("blm_1", "blm_2", "halation", "h_mask", "mask_bloom", "glow",
              "bloom")),
    ("geometry", ("warpx", "warpy", "c_shape", "curvature", "overscanx",
                  "overscany", "overscan", "zoom_mask", "warp", "zoom",
                  "shape")),
    ("frame", ("csize", "bsize", "sborder", "vigstr", "vigdef", "corner",
               "border", "vignette")),
    ("colour", ("gamma_i", "gamma_o", "pre_bb", "contra", "wp_saturation",
                "gamma", "bright", "contrast", "saturat", "black", "color",
                "level")),
    ("sharpness", ("h_sharp", "s_sharp", "smart_ei", "ring", "sharpen",
                   "sharp", "smooth", "blur")),
    ("convergence", ("deconrx", "decongx", "deconbx", "deconry", "decongy",
                     "deconby", "convergence", "aberration", "fringing")),
    ("scale", ("masksize", "size", "width", "height", "scale", "taps")),
)
# Options that cannot do anything under Gamescope, whatever the shader.
_PARAM_INERT = ("lut", "gamut", "profile", "persistence", "afterglow", "noise",
                "debug", "tate", "integer", "interlac", "field", "vga")
# How many are taken from each group before the next group gets a turn. Three
# keeps any one family (CRT-Guest-Advanced has 23 mask parameters) from filling
# the panel on its own.
PARAMS_PER_GROUP = 3


def _select_params(params: list, limit: int) -> list:
    """The best `limit` parameters: a spread over the groups, in priority order.

    A straight sort by interest would fill the list from the mask family alone
    and never show a curvature or a gamma slider; taking the shader's first
    `limit` is how the panel ended up offering ten inert ones. The chosen
    parameters keep the shader's own order, so a familiar shader still reads the
    way its author laid it out.
    """
    if limit <= 0 or len(params) <= limit:
        return params
    hay = [(f"{param['key']} {param['label']}".lower(), i)
           for i, param in enumerate(params)]
    inert = {i for text, i in hay if any(w in text for w in _PARAM_INERT)}
    chosen: set = set()
    for _name, words in _PARAM_GROUPS:
        if len(chosen) >= limit:
            break
        # Within a group the more specific word wins, so a shader that has both
        # a "Mask Strength" and a "Bloom Mask Strength" gives up the phosphor
        # mask first: the words are an order, not a set.
        group = []
        for text, i in hay:
            if i in inert or i in chosen:
                continue
            for rank, word in enumerate(words):
                if word in text:
                    group.append((rank, i))
                    break
        group.sort()
        for _rank, i in group[:PARAMS_PER_GROUP]:
            if len(chosen) >= limit:
                break
            chosen.add(i)
    # Anything still missing comes from what is left, neutrals first and the
    # inert ones only when a shader has nothing else at all.
    for pool in ([i for _t, i in hay if i not in chosen and i not in inert],
                 [i for _t, i in hay if i not in chosen]):
        for i in pool:
            if len(chosen) >= limit:
                break
            chosen.add(i)
    return [params[i] for i in sorted(chosen)]


COMMUNITY_PACKS = [
    {
        "id": "rsretroarch",
        "name": "RSRetroArch collection",
        "description": ("Curated RetroArch ports for ReShade: Hyllian, Lottes, "
                        "Geom, Caligari, Easymode and more."),
        "url": ("https://github.com/Matsilagi/RSRetroArch"
                "/archive/refs/heads/main.zip"),
    },
    {
        "id": "crt-guest",
        "name": "CRT-Guest ReShade",
        "description": "ReShade port of the CRT-Guest shader family.",
        "url": ("https://github.com/HelelSingh/CRT-Guest-ReShade"
                "/archive/refs/heads/main.zip"),
    },
]

def _param(key, label, default, maxv=1.0, minv=0.0, step=0.05):
    return {"key": key, "label": label, "min": minv, "max": maxv,
            "step": step, "default": default}


def _ssl_context():
    """TLS context backed by the system CA store.

    Decky's embedded Python ships without a CA bundle, so urllib downloads
    fail here with CERTIFICATE_VERIFY_FAILED while curl and the system Python
    on the same machine work fine.
    """
    import ssl
    for path in ("/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
                 "/etc/ssl/certs/ca-certificates.crt",
                 "/etc/pki/tls/certs/ca-bundle.crt"):
        if os.path.exists(path):
            try:
                return ssl.create_default_context(cafile=path)
            except OSError:
                continue
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001 - fall back to the default store
        return ssl.create_default_context()


def _source_lines(default=240):
    """How many scanlines the emulated tube had.

    Every bundled shader derives its scanline and mask pitch from this instead
    of from the output resolution. On a 4K panel a scanline every two OUTPUT
    rows is a flat grey veil and a triad every three OUTPUT columns beats
    against the panel's own stripes, so the pattern has to scale with the tube:
    224 an arcade monitor, 240 a 15 kHz TV, 272 the PPSSPP CRT shader, 480 a PVM.
    """
    return _param("SourceLines", "Source lines", default, minv=120, maxv=540,
                  step=1)


PRESETS = [
    {
        "id": "scanlines",
        "name": "Scanlines",
        "description": "Clean dark scanlines. Cheapest option, suits any game.",
        "file": LIGHT_SUBDIR + "/scanlines.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.40),
            _source_lines(),
        ],
    },
    {
        "id": "aperture-grille",
        "name": "Aperture grille",
        "description": "Trinitron-style vertical RGB stripes plus scanlines.",
        "file": LIGHT_SUBDIR + "/aperture-grille.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.35),
            _param("MaskStrength", "Grille strength", 0.18),
            _source_lines(),
        ],
    },
    {
        "id": "slot-mask",
        "name": "Slot mask + curve",
        "description": "Shadow-mask slots, barrel curvature and vignette. The full tube.",
        "file": LIGHT_SUBDIR + "/slot-mask.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.35),
            _param("MaskStrength", "Mask strength", 0.20),
            _param("Curvature", "Screen curvature", 0.10, maxv=0.30, step=0.01),
            _source_lines(),
        ],
    },
    {
        "id": "slot-mask-flat",
        "name": "Slot mask (flat)",
        "description": "Shadow-mask slots on a flat late-model tube. No curvature.",
        "file": LIGHT_SUBDIR + "/slot-mask-flat.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.35),
            _param("MaskStrength", "Mask strength", 0.20),
            _source_lines(),
        ],
    },
    {
        "id": "shadow-mask",
        "name": "Shadow mask",
        "description": "Dot-triad shadow mask. CGA/EGA-era vibes.",
        "file": LIGHT_SUBDIR + "/shadow-mask.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.30),
            _param("MaskStrength", "Mask strength", 0.22),
            _source_lines(),
        ],
    },
    {
        "id": "green-phosphor",
        "name": "Green phosphor",
        "description": "Monochrome P1 green terminal with halation glow.",
        "file": LIGHT_SUBDIR + "/green-phosphor.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.45),
            _param("Glow", "Phosphor glow", 0.35),
            _param("MaskStrength", "Grille strength", 0.15),
            _source_lines(),
        ],
    },
    {
        "id": "amber-phosphor",
        "name": "Amber phosphor",
        "description": "Monochrome amber terminal with halation glow.",
        "file": LIGHT_SUBDIR + "/amber-phosphor.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.45),
            _param("Glow", "Phosphor glow", 0.35),
            _param("MaskStrength", "Grille strength", 0.15),
            _source_lines(),
        ],
    },
    {
        "id": "bw-tv",
        "name": "B&W TV",
        "description": "Grayscale tube with scanlines and vignette.",
        "file": LIGHT_SUBDIR + "/bw-tv.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.40),
            _param("Vignette", "Vignette", 0.50),
            _source_lines(),
        ],
    },
    {
        "id": "composite",
        "name": "Composite",
        "description": "NTSC-ish color bleed: sharp luma, smeared chroma.",
        "file": LIGHT_SUBDIR + "/composite.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.35),
            _param("Bleed", "Color bleed", 0.60),
            _source_lines(),
        ],
    },
    {
        "id": "consumer-tv",
        "name": "Consumer TV",
        "description": "The crappy childhood RF TV: bleed, softness, curve.",
        "file": LIGHT_SUBDIR + "/consumer-tv.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.40),
            _param("Bleed", "Color bleed", 0.70),
            _param("Curvature", "Screen curvature", 0.12, maxv=0.30, step=0.01),
            _source_lines(),
        ],
    },
    {
        "id": "pvm",
        "name": "PVM",
        "description": "Broadcast monitor: sharp, fine grille, strong scanlines, flat.",
        "file": LIGHT_SUBDIR + "/pvm.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.50),
            _param("MaskStrength", "Grille strength", 0.25),
            _source_lines(480),
        ],
    },
    {
        "id": "arcade",
        "name": "Arcade",
        "description": "Arcade cabinet monitor: heavy slot mask, curve, strong scanlines.",
        "file": LIGHT_SUBDIR + "/arcade.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.50),
            _param("MaskStrength", "Mask strength", 0.25),
            _param("Curvature", "Screen curvature", 0.14, maxv=0.30, step=0.01),
            _source_lines(224),
        ],
    },
    {
        "id": "lottes",
        "name": "Lottes",
        "description": "Lottes-inspired: curved screen, grille, soft scanlines.",
        "file": LIGHT_SUBDIR + "/lottes.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.40),
            _param("MaskStrength", "Grille strength", 0.22),
            _param("Curvature", "Screen curvature", 0.12, maxv=0.30, step=0.01),
            _source_lines(),
        ],
    },
    {
        "id": "crt-pro",
        "name": "CRT Pro",
        "description": ("Two-pass aperture grille: halation pass, then beam "
                        "profile, source-locked grille and curvature."),
        "file": LIGHT_SUBDIR + "/crt-pro.fx",
        "heavy": False,
        "params": [
            _param("SourceLines", "Beam · source lines", 240, minv=120, maxv=540,
                   step=1),
            _param("ScanIntensity", "Beam · scanline depth", 0.35),
            _param("BeamWidth", "Beam · beam width", 0.50, minv=0.05, maxv=0.95,
                   step=0.05),
            _param("BeamSoftness", "Beam · softness", 1.00, minv=0.20,
                   maxv=4.00, step=0.05),
            _param("MaskType", "Mask · type 0-3 (off/grille/slot/dot)", 1.0,
                   maxv=3.0, step=1.0),
            _param("MaskStrength", "Mask · strength", 0.18, step=0.02),
            _param("MaskScale", "Mask · pitch x source pixel", 1.0, minv=1.0,
                   maxv=3.0, step=0.05),
            _param("MaskGamma", "Mask · gamma", 1.00, minv=0.25, maxv=3.00,
                   step=0.05),
            _param("GlowAmount", "Glow · halation", 0.30),
            _param("GlowX", "Glow · width X (source px)", 3.0, maxv=12.0,
                   step=0.5),
            _param("GlowY", "Glow · width Y (source px)", 3.0, maxv=12.0,
                   step=0.5),
            _param("GlowThreshold", "Glow · threshold", 0.0, maxv=0.90,
                   step=0.05),
            _param("Sharpness", "Sharpness", 0.25),
            _param("Convergence", "Convergence (RGB split)", 0.50, maxv=3.0,
                   step=0.05),
            _param("CurvatureX", "Screen · curve X", 0.10, maxv=0.30,
                   step=0.01),
            _param("CurvatureY", "Screen · curve Y", 0.10, maxv=0.30,
                   step=0.01),
            _param("Vignette", "Screen · vignette", 0.20),
            _param("CornerSize", "Screen · corner round", 0.0, maxv=0.35,
                   step=0.01),
            _param("Overscan", "Screen · overscan", 0.0, maxv=0.20,
                   step=0.01),
            _param("Brightness", "Color · brightness", 1.00, minv=0.50,
                   maxv=1.50, step=0.01),
            _param("Gamma", "Color · gamma", 1.00, minv=0.50, maxv=2.50,
                   step=0.05),
            _param("BlackLevel", "Color · black level", 0.0, minv=-0.20,
                   maxv=0.20, step=0.01),
            _param("Saturation", "Color · saturation", 1.00, maxv=2.00,
                   step=0.05),
            _param("ColorTemp", "Color · warm/cool", 0.50, step=0.05),
        ],
    },
    {
        "id": "crt-royale",
        "name": "CRT-Royale (heavy)",
        "description": "Full multi-pass CRT-Royale port. Experimental, needs a strong GPU.",
        "file": "",  # resolved from config["heavy_relpath"] after download
        "heavy": True,
        "params": [],
    },
]

# The order the panel shows presets in: best first, because a fifteen-way
# dropdown with no order in it is a wall of names and the good ones are not
# distinguishable from the dead ones. Lower rank sorts first.
#
# The rule, so it can be argued with rather than guessed at:
#   10-90   complete tube emulations, most complete/faithful first
#   100-140 the character pieces and the bare utilities
#   150     the heavy/experimental tier (also needs a download)
#   200+    community packs, by measured verdict: compiling shaders ahead of
#           untested ones, and the ones Gamescope rejects last of all
PRESET_RANK = {
    "crt-pro": 10,          # halation, beam shape, three masks, full trims
    "arcade": 20,           # heavy slot mask, curve, arcade line count
    "slot-mask": 30,        # the full tube: slots, curvature, vignette
    "pvm": 40,              # sharp broadcast monitor
    "lottes": 50,           # the soft end of the family
    "consumer-tv": 60,      # RF softness and colour bleed
    "slot-mask-flat": 70,
    "aperture-grille": 80,
    "shadow-mask": 90,
    "composite": 100,
    "green-phosphor": 110,
    "amber-phosphor": 120,
    "bw-tv": 130,
    "scanlines": 140,
    "crt-royale": 150,
}
# Community shaders are ranked by the verdicts measured off-device
# (community/verdicts.json) rather than by anyone's opinion of them. A crash
# sorts below a rejection: a rejected shader does nothing, a crashing one takes
# the compositor and the panel with it.
COMMUNITY_RANK_OK = 200
COMMUNITY_RANK_UNTESTED = 210
COMMUNITY_RANK_REJECT = 220
COMMUNITY_RANK_CRASH = 250
DEFAULT_RANK = 500

DEFAULT_CONFIG = {
    "global_enabled": False,
    "preset_id": "aperture-grille",
    "params": {
        p["id"]: {param["key"]: param["default"] for param in p["params"]}
        for p in PRESETS if not p["heavy"]
    },
    "heavy_relpath": "",
    "community_presets": [],
    "community_packs": [],
    # Games whose Steam launch options carry our per-game wrapper, keyed by
    # app id: {"<appid>": {"name": ..., "relpath": ..., "added_command": bool}}.
    # The wrapper outlives the game process, so it has to be tracked somewhere
    # the plugin can still read when the game is not running — otherwise
    # switching to Off or System-wide can never clean it up.
    "managed_apps": {},
}


class Plugin:
    def __init__(self, probe=None):
        # A toggle and a shader reapply must not race on Gamescope's one effect
        # property. This is per backend instance and local to this plugin.
        self._effect_lock = asyncio.Lock()
        # Everything that asks the system a question goes through here, so a
        # test can hand this a scripted adapter instead of assigning privates.
        self.probe = probe or SystemProbe()

    # ------------------------------------------------------------------ paths
    @property
    def _home(self) -> str:
        return decky.DECKY_USER_HOME

    @property
    def _plugin_dir(self) -> str:
        return os.path.join(decky.DECKY_HOME, "plugins", PLUGIN_SLUG)

    @property
    def _shader_base(self) -> str:
        return os.path.join(self._home, SHADER_BASE_REL)

    @property
    def _config_path(self) -> str:
        return os.path.join(self._home, CONFIG_PATH_REL)

    # ------------------------------------------------------------------ config
    def _load_config(self) -> dict:
        cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
        try:
            with open(self._config_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            for k, v in saved.items():
                cfg[k] = v
        except (OSError, ValueError):
            pass
        return cfg

    def _save_config(self, cfg: dict) -> None:
        os.makedirs(os.path.dirname(self._config_path), exist_ok=True)
        tmp = self._config_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp, self._config_path)

    def _preset_by_id(self, preset_id: str, cfg: dict) -> dict | None:
        for p in PRESETS:
            if p["id"] == preset_id:
                return p
        for p in cfg.get("community_presets", []):
            if p["id"] == preset_id:
                return p
        return None

    def _resolve_relpath(self, preset: dict, cfg: dict) -> str:
        """The one rule for where a preset's shader file lives."""
        if preset.get("heavy"):
            return cfg.get("heavy_relpath", "")
        return preset.get("relpath") or preset.get("file") or ""

    # ------------------------------------------------------------------ setup
    async def install_shaders(self) -> bool:
        """Copy bundled light shaders into the Gamescope reshade Shaders dir."""
        src = os.path.join(self._plugin_dir, "shaders")
        dst = os.path.join(self._shader_base, LIGHT_SUBDIR)
        # Fallback: when running from a source checkout, shaders sit next to main.py.
        if not os.path.isdir(src):
            src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shaders")
        if not os.path.isdir(src):
            decky.logger.error("DeckyCRT: bundled shaders not found at %s", src)
            return False
        os.makedirs(dst, exist_ok=True)
        for name in os.listdir(src):
            # .fxh ships too: every bundled shader includes crt-common.fxh, and
            # a copy without it fails at line 1 with "could not open included
            # file" — fourteen dead presets, silently.
            if name.endswith(".fx") or name.endswith(".fxh"):
                shutil.copy2(os.path.join(src, name), os.path.join(dst, name))
        decky.logger.info("DeckyCRT: light shaders installed to %s", dst)
        return True

    async def download_heavy(self) -> dict:
        """Download the CRT-Royale ReShade port. Returns {ok, relpath|detail}."""
        try:
            relpath = await asyncio.to_thread(self._download_heavy_sync)
            cfg = self._load_config()
            cfg["heavy_relpath"] = relpath
            self._save_config(cfg)
            return {"ok": True, "relpath": relpath}
        except Exception as e:  # noqa: BLE001 - report to UI
            decky.logger.error("DeckyCRT heavy download failed: %s", e)
            return {"ok": False, "detail": str(e)[:300]}

    def _download_heavy_sync(self) -> str:
        tmp = tempfile.mkdtemp(prefix="deckycrt-heavy-")
        try:
            zip_path = os.path.join(tmp, "heavy.zip")
            req = urllib.request.Request(
                HEAVY_ZIP_URL, headers={"User-Agent": "deckycrt/0.1"})
            with urllib.request.urlopen(req, timeout=120,
                                        context=_ssl_context()) as r, \
                    open(zip_path, "wb") as f:
                shutil.copyfileobj(r, f)
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(tmp)
            # Find the extracted root (zip has a single top-level dir).
            roots = [os.path.join(tmp, n) for n in os.listdir(tmp)
                     if os.path.isdir(os.path.join(tmp, n))]
            if not roots:
                raise RuntimeError("zip extracted with no directories")
            src_root = roots[0]

            target = os.path.join(self._shader_base, HEAVY_SUBDIR)
            shutil.rmtree(target, ignore_errors=True)
            if os.path.exists(target):
                raise RuntimeError(
                    f"{target} exists and is not writable by "
                    f"{pwd.getpwuid(os.geteuid()).pw_name} — remove that "
                    "directory and retry")
            shutil.copytree(src_root, target)

            # Discover the main .fx: prefer a *royale*.fx, shallowest first.
            candidates = []
            for root, _dirs, files in os.walk(target):
                for fn in files:
                    if fn.lower().endswith(".fx"):
                        rel = os.path.relpath(os.path.join(root, fn), target)
                        score = (0 if "royale" in fn.lower() else 1,
                                 rel.count(os.sep))
                        candidates.append((score, rel))
            if not candidates:
                raise RuntimeError("no .fx files found in downloaded pack")
            candidates.sort(key=lambda c: c[0])
            best = candidates[0][1].replace(os.sep, "/")
            decky.logger.info("DeckyCRT: heavy shader installed as %s",
                              HEAVY_SUBDIR + "/" + best)
            return HEAVY_SUBDIR + "/" + best
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # ------------------------------------------------------- community packs
    @staticmethod
    def _ann_float(ann: str, name: str, default: float) -> float:
        m = re.search(r"\b" + re.escape(name) + r"\s*=\s*([-+0-9.eE]+)", ann)
        if not m:
            return default
        try:
            return float(m.group(1))
        except ValueError:
            return default

    @staticmethod
    def _ann_str(ann: str, name: str) -> str:
        m = re.search(r"\b" + re.escape(name) + r'\s*=\s*"([^"]*)"', ann)
        return m.group(1) if m else ""

    @staticmethod
    def _prettify(name: str) -> str:
        s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
        return s.replace("_", " ").replace("-", " ").strip()

    def _parse_uniforms(self, text: str, limit: int = COMMUNITY_PARAM_LIMIT) -> list:
        """Extract tunable float uniforms from a ReShade .fx file.

        The range matters as much as the value: every parameter is rendered as
        a slider, and a default sitting outside its own [min, max] is not
        representable — Steam's SliderField throws on it and the whole panel
        goes down. Community shaders rarely carry ui_min/ui_max annotations and
        their defaults are often magnitudes (320, 240), so a missing range is
        derived from the default instead of defaulting to 0..1.

        Skips gamescope built-ins (source = ...) and hidden uniforms.
        """
        params = []
        pattern = re.compile(
            r"uniform\s+float\s+([A-Za-z_][A-Za-z0-9_]*)\s*"
            r"(?:<\s*([^>]*)>)?\s*=\s*([-+0-9.eE]+)\s*;",
            re.MULTILINE)
        for m in pattern.finditer(text):
            key, ann, default = m.group(1), m.group(2) or "", m.group(3)
            if key.startswith("_"):
                continue
            if re.search(r"\bsource\s*=", ann):
                continue  # gamescope built-in (timer, framecount, ...)
            if "hidden" in ann.lower():
                continue
            try:
                dflt = float(default)
            except ValueError:
                continue
            if not math.isfinite(dflt):
                continue

            if ("ui_min" in ann) or ("ui_max" in ann):
                lo = self._ann_float(ann, "ui_min", 0.0)
                hi = self._ann_float(ann, "ui_max", 1.0)
            elif dflt == 0.0:
                lo, hi = 0.0, 1.0
            elif dflt > 0.0:
                lo, hi = 0.0, dflt * 2.0
            else:
                lo, hi = dflt * 2.0, 0.0

            # The declared default must always be reachable.
            lo, hi = min(lo, dflt), max(hi, dflt)
            if not (math.isfinite(lo) and math.isfinite(hi) and hi > lo):
                lo, hi = min(0.0, dflt), max(1.0, dflt)

            span = hi - lo
            step = self._ann_float(ann, "ui_step", 0.0)
            if not (math.isfinite(step) and 0.0 < step <= span):
                # 100 positions feels continuous without being unusable.
                step = round(span / 100.0, 6) or span / 100.0
            label = self._ann_str(ann, "ui_label") or self._prettify(key)
            params.append({"key": key, "label": label, "min": round(lo, 6),
                           "max": round(hi, 6), "step": step, "default": dflt})
        return _select_params(params, limit)

    async def download_pack(self, pack_id: str) -> dict:
        pack = next((x for x in COMMUNITY_PACKS if x["id"] == pack_id), None)
        if not pack:
            return {"ok": False, "detail": "unknown pack"}
        try:
            added = await asyncio.to_thread(self._download_pack_sync, pack)
        except Exception as e:  # noqa: BLE001 - report to UI
            decky.logger.error("DeckyCRT pack download failed: %s", e)
            return {"ok": False, "detail": str(e)[:300]}
        cfg = self._load_config()
        cfg["community_presets"] = [
            c for c in cfg.get("community_presets", [])
            if c.get("pack") != pack_id
        ]
        cfg["community_presets"].extend(added)
        for c in added:
            cfg.setdefault("params", {}).setdefault(
                c["id"], {p["key"]: p["default"] for p in c["params"]})
        if pack_id not in cfg.setdefault("community_packs", []):
            cfg["community_packs"].append(pack_id)
        self._save_config(cfg)
        return {"ok": True,
                "detail": f"Added {len(added)} shaders from {pack['name']}"}

    def _download_pack_sync(self, pack: dict) -> list:
        tmp = tempfile.mkdtemp(prefix="deckycrt-pack-")
        try:
            zip_path = os.path.join(tmp, "pack.zip")
            req = urllib.request.Request(
                pack["url"], headers={"User-Agent": "deckycrt/0.1"})
            with urllib.request.urlopen(req, timeout=180,
                                        context=_ssl_context()) as r, \
                    open(zip_path, "wb") as f:
                shutil.copyfileobj(r, f)
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(tmp)
            roots = [os.path.join(tmp, n) for n in os.listdir(tmp)
                     if os.path.isdir(os.path.join(tmp, n))]
            if not roots:
                raise RuntimeError("pack extracted with no directories")
            src_root = roots[0]

            target_base = os.path.join(self._shader_base, COMMUNITY_SUBDIR,
                                       pack["id"])
            shutil.rmtree(target_base, ignore_errors=True)
            if os.path.exists(target_base):
                raise RuntimeError(
                    f"{target_base} exists and is not writable by "
                    f"{pwd.getpwuid(os.geteuid()).pw_name} — remove that "
                    "directory and retry")
            os.makedirs(target_base, exist_ok=True)
            # Preserve the repo's Shaders/Textures sibling layout.
            for name in ("Shaders", "Textures"):
                src = os.path.join(src_root, name)
                if os.path.isdir(src):
                    shutil.copytree(src, os.path.join(target_base, name))

            shaders_dir = os.path.join(target_base, "Shaders")
            if not os.path.isdir(shaders_dir):
                raise RuntimeError("no Shaders dir found in pack")
            self._ensure_pack_header(target_base)
            added = []
            for fn in sorted(os.listdir(shaders_dir)):
                if not fn.lower().endswith(".fx"):
                    continue
                fpath = os.path.join(shaders_dir, fn)
                with open(fpath, encoding="utf-8", errors="replace") as f:
                    text = f.read()
                params = self._parse_uniforms(text)
                slug = os.path.splitext(fn)[0]
                pid = ("community-" + pack["id"] + "-"
                       + re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-"))
                relpath = f"{COMMUNITY_SUBDIR}/{pack['id']}/Shaders/{fn}"
                added.append({
                    "id": pid,
                    "name": self._prettify(slug),
                    "description": (f"Community shader ({pack['name']}). "
                                    "Experimental: may not compile on all "
                                    "Gamescope builds."),
                    "file": relpath,
                    "relpath": relpath,
                    "heavy": False,
                    "community": True,
                    "pack": pack["id"],
                    "params": params,
                })
            if not added:
                raise RuntimeError("no .fx shaders found in pack")
            decky.logger.info("DeckyCRT: pack %s installed (%d shaders)",
                              pack["id"], len(added))
            return added
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    async def remove_pack(self, pack_id: str) -> dict:
        cfg = self._load_config()
        removed_ids = {c["id"] for c in cfg.get("community_presets", [])
                       if c.get("pack") == pack_id}
        cfg["community_presets"] = [
            c for c in cfg.get("community_presets", [])
            if c.get("pack") != pack_id
        ]
        if pack_id in cfg.get("community_packs", []):
            cfg["community_packs"].remove(pack_id)
        params = cfg.get("params", {})
        for pid in removed_ids:
            params.pop(pid, None)
        if (cfg.get("preset_id") or "").startswith(f"community-{pack_id}-"):
            cfg["preset_id"] = "aperture-grille"
            cfg["global_enabled"] = False
        self._save_config(cfg)
        shutil.rmtree(os.path.join(self._shader_base, COMMUNITY_SUBDIR,
                                   pack_id),
                      ignore_errors=True)
        try:
            # Leave no empty parent behind once the last pack is gone.
            os.rmdir(os.path.join(self._shader_base, COMMUNITY_SUBDIR))
        except OSError:
            pass
        decky.logger.info("DeckyCRT: pack %s removed", pack_id)
        return {"ok": True, "detail": "Pack removed."}

    def _bundled_header(self) -> str | None:
        for cand in (
            os.path.join(self._plugin_dir, "community", COMMUNITY_HEADER),
            os.path.join(self._plugin_dir, "shaders", COMMUNITY_HEADER),
            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "community", COMMUNITY_HEADER),
        ):
            if os.path.isfile(cand):
                return cand
        return None

    def _ensure_pack_header(self, pack_dir: str) -> bool:
        """Make sure a pack's Shaders dir contains ReShade.fxh.

        Community shaders all `#include "ReShade.fxh"` and Gamescope provides no
        ReShade headers, so a pack without this file compiles none of them.
        """
        shaders = os.path.join(pack_dir, "Shaders")
        if not os.path.isdir(shaders):
            return False
        dst = os.path.join(shaders, COMMUNITY_HEADER)
        src = self._bundled_header()
        try:
            if src:
                if (not os.path.isfile(dst)
                        or os.path.getsize(dst) != os.path.getsize(src)):
                    shutil.copyfile(src, dst)
                return True
            if os.path.isfile(dst):
                return True
            req = urllib.request.Request(
                COMMUNITY_HEADER_URL, headers={"User-Agent": "deckycrt/0.2"})
            with urllib.request.urlopen(req, timeout=30,
                                        context=_ssl_context()) as r:
                data = r.read()
            with open(dst, "wb") as f:
                f.write(data)
            return True
        except Exception as e:  # noqa: BLE001 - a pack without it still lists
            decky.logger.error("DeckyCRT: no %s for %s: %s",
                               COMMUNITY_HEADER, pack_dir, e)
            return False

    async def ensure_pack_headers(self) -> int:
        """Self-heal packs installed before the header was bundled."""
        base = os.path.join(self._shader_base, COMMUNITY_SUBDIR)
        fixed = 0
        try:
            for name in os.listdir(base):
                pack_dir = os.path.join(base, name)
                if os.path.isdir(pack_dir) and self._ensure_pack_header(pack_dir):
                    fixed += 1
        except OSError:
            pass
        if fixed:
            decky.logger.info("DeckyCRT: ensured %s in %d pack(s)",
                              COMMUNITY_HEADER, fixed)
        return fixed

    async def migrate_params(self) -> bool:
        """Re-derive stored community params after a parser rule change.

        Stored params carry the slider ranges that were computed when the pack
        was downloaded. A pack installed under older rules keeps handing the
        panel ranges its own defaults don't fit — which takes the panel down on
        preset switch. User-tuned values are kept, clamped into the new range.
        """
        cfg = self._load_config()
        if cfg.get("params_rev") == PARAMS_REV:
            return False
        refreshed = 0
        for cp in cfg.get("community_presets", []):
            relpath = self._resolve_relpath(cp, cfg)
            if not relpath:
                continue
            path = os.path.join(self._shader_base, relpath)
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            params = self._parse_uniforms(text)
            if not params:
                continue
            stored = cfg.setdefault("params", {}).setdefault(cp["id"], {})
            merged = {}
            for spec in params:
                v = stored.get(spec["key"], spec["default"])
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    v = spec["default"]
                if not math.isfinite(v):
                    v = spec["default"]
                merged[spec["key"]] = min(max(v, spec["min"]), spec["max"])
            cfg["params"][cp["id"]] = merged
            if cp.get("params") != params:
                cp["params"] = params
                refreshed += 1
        cfg["params_rev"] = PARAMS_REV
        self._save_config(cfg)
        decky.logger.info("DeckyCRT: re-derived params for %d community shaders",
                          refreshed)
        return True

    # ------------------------------------------------------------ app registry
    async def note(self, message: str) -> dict:
        """Record a line from the panel in this plugin's own log.

        The panel's `console.log` only reaches Steam's CEF console, which is not
        always written to disk and is useless when a mode change "does nothing".
        Anything the panel wants to be checkable goes through here as well.
        """
        decky.logger.info("DeckyCRT/panel: %s", str(message)[:400])
        return {"ok": True, "detail": ""}

    # The parsers live beside the commands they parse (deckycrt_probe) and are
    # re-exported here, so a caller of main.py need not know where they moved.
    _parse_core_line = staticmethod(parse_core_line)
    _wrapper_appid_from_cmdline = staticmethod(wrapper_appid_from_cmdline)

    async def wrapped_running_apps(self) -> dict:
        """Apps running RIGHT NOW under our nested gamescope.

        This is how the panel can tell "the per-game filter is live in this
        process" from "a wrapper is merely saved for next launch" — the two
        look identical in Steam's saved options, and only the first one means
        system-wide would filter the same pixels twice.

        Fails closed: an unanswerable probe reports ok=False, because guessing
        "none running" is exactly what stacks the two filters.
        """
        result = self.probe.running_wrapped_apps()
        if isinstance(result, Unknown):
            decky.logger.error("DeckyCRT: wrapped-app probe unknown: %s",
                               result.reason)
            return {"ok": False,
                    "detail": "Could not determine whether a wrapped game is running.",
                    "app_ids": []}
        return {"ok": True, "app_ids": result.value}

    async def check_wrapper_crashes(self) -> dict:
        """Detect a game whose launch died with gamescope and report it.

        A per-game wrapper puts gamescope in the launch path of the game, so a
        gamescope crash there means the game never starts — which reads to the
        user as "this game will not launch any more". The core dump names both
        the wrapper and the app id, so the panel can strip exactly the wrapper
        that is doing it instead of leaving the game unlaunchable.

        Fails closed: a scan that could not run is *not* "no crashes". The user
        would otherwise be left with a game that will not launch and no notice
        that we never managed to look.
        """
        cfg = self._load_config()
        managed = cfg.get("managed_apps") or {}
        if not managed:
            return {"ok": True, "crashes": []}
        found = self.probe.core_dumps("3 days ago")
        if isinstance(found, Unknown):
            decky.logger.error("DeckyCRT: core-dump scan unknown: %s",
                               found.reason)
            return {"ok": False,
                    "detail": ("Could not read the core dump list: "
                               + found.reason[:200]),
                    "crashes": []}
        seen = {str(x) for x in (cfg.get("crash_scan_seen") or [])}
        crashes = []
        classified = []
        unnamed = 0
        for pid in found.value:
            if pid in seen:
                continue
            cmdline = self.probe.core_cmdline(pid)
            if isinstance(cmdline, Unknown):
                # Do not record it as seen: a core we could not name must be
                # retried on the next mount, not forgotten.
                unnamed += 1
                continue
            classified.append(pid)
            app_id = wrapper_appid_from_cmdline(cmdline.value)
            if app_id is None or str(app_id) not in managed:
                continue
            entry = managed[str(app_id)]
            crashes.append({
                "app_id": app_id,
                "name": entry.get("name") or f"App {app_id}",
                "shader": entry.get("relpath") or "",
            })
        if classified:
            cfg["crash_scan_seen"] = (sorted(seen | set(classified)))[-50:]
            self._save_config(cfg)
        if crashes:
            decky.logger.error(
                "DeckyCRT: gamescope crashed launching %s under a per-game "
                "wrapper; the wrapper should be removed",
                ", ".join(str(c["app_id"]) for c in crashes))
        if unnamed:
            decky.logger.error(
                "DeckyCRT: %s core dump(s) could not be named and will be "
                "checked again next mount", unnamed)
        return {"ok": True, "crashes": crashes}

    async def set_managed_app(self, app_id: int, name: str, relpath: str,
                              enabled: bool,
                              added_command: bool = False) -> dict:
        """Track (or untrack) a game whose launch options carry our wrapper.

        Steam keeps the wrapper after the game exits, so Off / System-wide need
        this registry to find and clean it. `added_command` records whether the
        wrapper had to synthesize `%command%`, because removal must take that
        placeholder back out to restore the original options exactly.
        """
        try:
            key = str(int(app_id))
        except (TypeError, ValueError):
            return {"ok": False, "detail": "invalid app id"}
        if key == "0":
            return {"ok": False, "detail": "invalid app id"}
        cfg = self._load_config()
        managed = dict(cfg.get("managed_apps") or {})
        if enabled:
            managed[key] = {"name": str(name)[:80],
                            "relpath": str(relpath)[:200],
                            "added_command": bool(added_command)}
        else:
            managed.pop(key, None)
        cfg["managed_apps"] = managed
        self._save_config(cfg)
        decky.logger.info("DeckyCRT: managed apps now %s",
                          ",".join(sorted(managed)) or "(none)")
        return {"ok": True, "detail": f"{len(managed)} game(s) tracked"}

    async def clear_managed_apps(self) -> dict:
        """Drop the whole registry (used once every wrapper is really gone)."""
        cfg = self._load_config()
        cfg["managed_apps"] = {}
        self._save_config(cfg)
        return {"ok": True, "detail": "Tracking cleared."}

    # ------------------------------------------------------------ preset order
    def _shader_verdicts(self) -> dict:
        """Gamescope's compile verdict per community shader, as measured.

        A rejected shader is silent: the property write succeeds, the effect
        never loads, and the preset does nothing at all. The registry ships with
        the plugin so the list can put the shaders that work first instead of
        leaving the user to discover the dead ones one at a time.
        """
        for base in (self._plugin_dir,
                     os.path.dirname(os.path.abspath(__file__))):
            try:
                with open(os.path.join(base, VERDICT_PATH_REL),
                          encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
            except (OSError, ValueError):
                continue
        return {}

    @staticmethod
    def _verdict_for(relpath: str, verdicts: dict) -> str:
        """ok | untested | reject | crash for one shader path.

        Matched on the path suffix: the registry records a path inside the
        shader directory, while the config's relpath carries the plugin's own
        subdirectory prefix. Crash is checked first, because a shader that
        crashes the compositor can still print "Compiling pass" before it dies
        and would otherwise be filed under ok.
        """
        rel = str(relpath or "")
        if not rel:
            return "untested"
        for key in ("crash", "ok", "untested", "reject"):
            for recorded in (verdicts.get(key) or {}):
                if rel.endswith(recorded):
                    return key
        return "untested"

    def _rank_of(self, entry: dict, verdicts: dict) -> int:
        if not entry.get("community"):
            return PRESET_RANK.get(entry.get("id"), DEFAULT_RANK)
        return {"ok": COMMUNITY_RANK_OK,
                "untested": COMMUNITY_RANK_UNTESTED,
                "reject": COMMUNITY_RANK_REJECT,
                "crash": COMMUNITY_RANK_CRASH}[
                    self._verdict_for(entry.get("relpath", ""), verdicts)]

    # ------------------------------------------------------------------ status
    async def get_status(self) -> dict:
        cfg = self._load_config()
        live_effect = self._live_global_effect()
        verdicts = self._shader_verdicts()
        presets = []
        for p in PRESETS:
            entry = dict(p)
            entry["relpath"] = self._resolve_relpath(p, cfg)
            if p["heavy"] and not entry["relpath"]:
                entry["relpath"] = ""
            presets.append(entry)
        crashes = verdicts.get("crash")
        if not isinstance(crashes, dict):
            crashes = {}
        rejections = verdicts.get("reject")
        if not isinstance(rejections, dict):
            rejections = {}
        for cp in cfg.get("community_presets", []):
            entry = dict(cp)
            entry["community"] = True
            relpath = str(entry.get("relpath", ""))
            verdict = self._verdict_for(relpath, verdicts)
            entry["verdict"] = verdict
            # Say it where the preset is picked, not in a log nobody reads. Both
            # dead ends are silent on the device: a rejected shader compiles to
            # nothing, and a crashing one is only visible after the session is
            # already gone.
            if verdict in ("crash", "reject"):
                table = crashes if verdict == "crash" else rejections
                reason = next((msg for path, msg in table.items()
                               if relpath.endswith(path)), "")
                where = f" ({reason})" if reason else ""
                if verdict == "crash":
                    entry["name"] = f"{entry.get('name', '')} — crashes Gamescope"
                    entry["description"] = (
                        f"This shader crashes gamescope{where}. Selecting it "
                        "takes the whole session down and the panel with it, and "
                        "in per-game mode it leaves that game unable to launch "
                        "until the wrapper is removed. It is listed last for "
                        "that reason. " + str(entry.get("description", "")))
                else:
                    entry["name"] = f"{entry.get('name', '')} — won't load"
                    entry["description"] = (
                        f"Gamescope's shader compiler rejects this one{where}, so "
                        "selecting it does nothing. It is listed last for that "
                        "reason. " + str(entry.get("description", "")))
            presets.append(entry)
        # One place decides the order, and the panel just renders it.
        for entry in presets:
            entry["rank"] = self._rank_of(entry, verdicts)
        presets.sort(key=lambda e: (e["rank"], (e.get("name") or "").lower()))
        light_dir = os.path.join(self._shader_base, LIGHT_SUBDIR)
        shaders_installed = os.path.isdir(light_dir) and any(
            n.endswith(".fx") for n in os.listdir(light_dir))
        return {
            "reshade_supported": self._gamescope_reshade_supported(),
            "effect_reachable": self._effect_reachable(),
            "effect_access": self.probe.effect_access(),
            "crash_guard_available": self.probe.crash_guard_available(),
            "displays": self._display_list(),
            "shaders_installed": shaders_installed,
            "heavy_installed": bool(cfg.get("heavy_relpath")),
            # The live effect path itself, not just whether it is on: the panel
            # derives the filter mode from this, and `null` (unreadable) is a
            # different answer from "" (nothing applied).
            "live_effect": live_effect,
            "global_enabled": (None if live_effect is None else bool(live_effect)),
            "preset_id": cfg.get("preset_id", "aperture-grille"),
            "params": cfg.get("params", {}),
            "presets": presets,
            "managed_apps": cfg.get("managed_apps") or {},
            "community_packs": [
                {"id": pack["id"], "name": pack["name"],
                 "description": pack["description"],
                 "installed": pack["id"] in cfg.get("community_packs", [])}
                for pack in COMMUNITY_PACKS
            ],
        }

    def _gamescope_reshade_supported(self) -> bool:
        result = self.probe.reshade_supported()
        if isinstance(result, Unknown):
            decky.logger.error("DeckyCRT: reshade support probe unknown: %s",
                               result.reason)
            return False
        return result.value

    def _display_list(self) -> list:
        """Gamescope displays, or [] when that could not be established.

        Every caller reads [] as "no global mode is reachable" and refuses the
        change, so an unanswerable probe cannot silently write nowhere.
        """
        result = self.probe.displays()
        if isinstance(result, Unknown):
            decky.logger.error("DeckyCRT: display probe unknown: %s",
                               result.reason)
            return []
        return result.value

    _parse_effect_property = staticmethod(parse_effect_property)

    def _live_global_effect(self) -> str | None:
        """Return the exact live effect path; None means unreadable."""
        for display in self._display_list():
            result = self.probe.read_effect(display)
            if isinstance(result, Ok):
                return result.value
            decky.logger.error("DeckyCRT: effect read failed on %s: %s",
                               display, result.reason)
        return None

    async def _read_effect_until(self, expected: str, displays: list) -> tuple[bool, str]:
        """Poll readback: xprop's write can precede Gamescope's render tick."""
        last = ""
        for attempt in range(16):
            answered = False
            for display in displays:
                result = self.probe.read_effect(display)
                if isinstance(result, Unknown):
                    last = result.reason
                    continue
                answered = True
                if result.value == expected:
                    return True, display
                last = f"{display}: still {result.value!r}"
            if attempt < 15 and answered:
                await asyncio.sleep(0.125)
        return False, last

    async def _set_global_enabled_locked(self, enabled: bool) -> dict:
        """Write + read back while caller holds _effect_lock."""
        cfg = self._load_config()
        preset = self._preset_by_id(cfg.get("preset_id", "aperture-grille"),
                                    cfg)
        relpath = self._resolve_relpath(preset, cfg) if preset else ""
        if enabled and not relpath:
            return {"ok": False, "detail": "No shader installed for this preset."}
        access = self.probe.effect_access()
        if access == "none":
            return {"ok": False,
                    "detail": ("Nothing on this system can set Gamescope's "
                               "effect property: no usable X client and no "
                               "xprop binary.")}
        displays = self._display_list()
        if not displays:
            return {"ok": False,
                    "detail": "No Gamescope display reachable over xprop."}
        expected = relpath if enabled else ""
        last_error = ""
        for display in displays:
            written = self.probe.write_effect(display, expected)
            if isinstance(written, Unknown):
                last_error = written.reason
                continue
            matched, observed = await self._read_effect_until(expected, displays)
            if not matched:
                last_error = observed
                continue
            cfg["global_enabled"] = enabled
            self._save_config(cfg)
            state = "enabled" if enabled else "disabled"
            decky.logger.info("DeckyCRT: global CRT %s on %s", state, observed)
            return {"ok": True,
                    "detail": f"Global CRT {state} (display {observed})."}
        return {"ok": False,
                "detail": f"Could not verify Gamescope effect change: {last_error[:200]}"}

    async def _set_global_enabled_impl(self, enabled: bool) -> dict:
        """Serialize and make repeated mode events idempotent."""
        async with self._effect_lock:
            current = self._live_global_effect()
            if current is None:
                return {"ok": False,
                        "detail": "Could not read the live Gamescope effect; no change made."}
            cfg = self._load_config()
            preset = self._preset_by_id(cfg.get("preset_id", "aperture-grille"),
                                        cfg)
            relpath = self._resolve_relpath(preset, cfg) if preset else ""
            target = relpath if enabled else ""
            if enabled and not target:
                return {"ok": False,
                        "detail": "No shader installed for this preset."}
            if current == target:
                cfg["global_enabled"] = enabled
                self._save_config(cfg)
                state = "enabled" if enabled else "disabled"
                return {"ok": True, "detail": f"Global CRT already {state}."}
            return await self._set_global_enabled_locked(enabled)

    async def set_global_enabled(self, enabled: bool) -> dict:
        return await self._set_global_enabled_impl(enabled)

    def _effect_reachable(self) -> bool:
        """Whether global mode can be reached at all: some mechanism to set the
        property, and a display to set it on."""
        return (self.probe.effect_access() != "none"
                and bool(self._display_list()))

    async def get_diagnostics(self) -> dict:
        """What this plugin can see about the system it is running on.

        Every capability the plugin depends on, answered by the machine itself,
        plus which mechanism is actually in use where it has a choice. This is
        the portability instrument: on a setup nobody has tested, it is one
        paste instead of a conversation, and it names the missing piece rather
        than leaving a mode that silently does nothing.
        """
        def which(name):
            return shutil.which(name) or ""

        light = os.path.join(self._shader_base, LIGHT_SUBDIR)
        try:
            installed = len([n for n in os.listdir(light) if n.endswith(".fx")])
        except OSError:
            installed = 0
        displays = self._display_list()
        live = (self.probe.read_effect(displays[0]) if displays
                else Unknown("no display"))
        version = self.probe.gamescope_version()
        x11_line = "module not shipped"
        if deckycrt_x11:
            x11_line = (deckycrt_x11.describe(displays[0]) if displays
                        else deckycrt_x11.describe())

        rows = [
            ("plugin_version", self._plugin_version()),
            ("decky_user_home", self._home),
            ("plugin_dir", self._plugin_dir),
            ("config_path", self._config_path),
            ("config_exists", os.path.isfile(self._config_path)),
            ("gamescope_binary", which("gamescope")),
            ("gamescope_version", version.value if isinstance(version, Ok) else f"unknown ({version.reason})"),
            ("reshade_supported", self._gamescope_reshade_supported()),
            ("effect_access", self.probe.effect_access()),
            ("libx11", "present" if deckycrt_x11 and deckycrt_x11.available() else "not loadable"),
            ("libx11_display", x11_line),
            ("xprop_binary", which("xprop") or "(not installed)"),
            ("displays", ", ".join(displays) or "(none found)"),
            # Which one the plugin will actually read and write. On a machine
            # with `--xwayland-count 2` the second Xwayland carries a mirror of
            # the effect property, and writing to that mirror is a no-op that
            # reads back as success — so this row is the first thing to check
            # when "system-wide does nothing".
            ("effect_display", displays[0] if displays else "(none)"),
            ("live_effect", live.value if isinstance(live, Ok) else "unreadable"),
            ("shader_dir_user", self._shader_base),
            ("shader_dir_system", "/usr/share/gamescope/reshade/Shaders"),
            ("light_shaders_installed", installed),
            ("coredumpctl", which("coredumpctl") or "(not installed: crash guard disabled)"),
            ("ps", which("ps") or "(not installed: probe disabled)"),
            ("xdg_data_home", os.environ.get("XDG_DATA_HOME", "(unset)")),
            ("session_type", os.environ.get("XDG_SESSION_TYPE", "(unset)")),
        ]
        return {"ok": True,
                "rows": [{"label": k, "value": str(v)} for k, v in rows]}

    def _plugin_version(self) -> str:
        try:
            with open(os.path.join(self._plugin_dir, "package.json"),
                      encoding="utf-8") as f:
                return str(json.load(f).get("version", "unknown"))
        except (OSError, ValueError):
            return "unknown"

    # ------------------------------------------------------------------ apply
    async def set_preset(self, preset_id: str) -> dict:
        async with self._effect_lock:
            cfg = self._load_config()
            preset = self._preset_by_id(preset_id, cfg)
            if not preset:
                return {"ok": False, "detail": "unknown preset"}
            if preset["heavy"] and not cfg.get("heavy_relpath"):
                return {"ok": False,
                        "detail": "Heavy shaders not downloaded yet."}
            # Read what is actually on screen: a stale stored flag would
            # re-apply a filter the user already switched off.
            live = self._live_global_effect()
            if live is None:
                return {"ok": False,
                        "detail": "Could not read the live Gamescope effect; preset not changed."}
            cfg["preset_id"] = preset_id
            self._save_config(cfg)
            detail = f"Preset: {preset['name']}"
            if live:
                res = await self._set_global_enabled_locked(True)
                if not res.get("ok"):
                    return {"ok": False,
                            "detail": detail + " — reapply failed: "
                                      + res.get("detail", "")}
                detail += " — " + res.get("detail", "")
            return {"ok": True, "detail": detail}

    async def set_param(self, preset_id: str, key: str, value: float,
                        reapply: bool = True) -> dict:
        """Bake a slider value into the shader's uniform initializer."""
        async with self._effect_lock:
            cfg = self._load_config()
            preset = self._preset_by_id(preset_id, cfg)
            if not preset or preset["heavy"]:
                return {"ok": False, "detail": "preset has no tunable params"}
            if key not in {p["key"] for p in preset.get("params", [])}:
                return {"ok": False, "detail": f"param {key} not found"}
            # Validate before touching the file: a NaN or an out-of-range value
            # must never be baked into a shader.
            spec = next((p for p in preset.get("params", []) if p["key"] == key),
                        None)
            try:
                value = float(value)
            except (TypeError, ValueError):
                return {"ok": False, "detail": f"invalid value for {key}"}
            if not math.isfinite(value):
                return {"ok": False, "detail": f"invalid value for {key}"}
            if spec:
                lo, hi = spec.get("min"), spec.get("max")
                if (isinstance(lo, (int, float)) and isinstance(hi, (int, float))
                        and hi > lo):
                    value = min(max(value, lo), hi)
            if preset.get("community"):
                # Community shaders are baked in place (no pristine template).
                template = target = os.path.join(self._shader_base,
                                                 preset["relpath"])
            else:
                template = os.path.join(self._plugin_dir, "shaders",
                                        os.path.basename(preset["file"]))
                if not os.path.isfile(template):
                    template = os.path.join(
                        os.path.dirname(os.path.abspath(__file__)),
                        "shaders", os.path.basename(preset["file"]))
                target = os.path.join(self._shader_base, preset["file"])
            try:
                with open(template, "r", encoding="utf-8") as f:
                    text = f.read()
                pattern = (r"(uniform\s+float\s+" + re.escape(key)
                           + r"\s*(?:<[^>]*>)?\s*=\s*)[-+0-9.eE]+")
                new_text, n = re.subn(pattern, r"\g<1>" + f"{value:.4f}", text,
                                      count=1)
                if n == 0:
                    return {"ok": False, "detail": f"param {key} not found"}
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "w", encoding="utf-8") as f:
                    f.write(new_text)
            except OSError as e:
                return {"ok": False, "detail": str(e)[:200]}

            cfg.setdefault("params", {}).setdefault(preset_id, {})[key] = value
            self._save_config(cfg)

            detail = f"{key} = {value:.2f}"
            if reapply:
                # Only recompile if the effect is live right now. A slider event
                # queued before Off must not turn the filter back on.
                live = self._live_global_effect()
                if live is None:
                    return {"ok": False,
                            "detail": detail + " — could not read live effect; "
                                      "slider saved without reapply."}
                if live:
                    off = await self._set_global_enabled_locked(False)
                    if not off.get("ok"):
                        return {"ok": False,
                                "detail": detail + " — disable for reapply failed: "
                                          + off.get("detail", "")}
                    res = await self._set_global_enabled_locked(True)
                    if not res.get("ok"):
                        return {"ok": False,
                                "detail": detail + " — reapply failed: "
                                          + res.get("detail", "")}
                    detail += " — " + res.get("detail", "")
            return {"ok": True, "detail": detail}

    # ------------------------------------------------------------------ hooks
    async def _main(self):
        self.loop = asyncio.get_event_loop()
        decky.logger.info("DeckyCRT backend loaded.")
        try:
            if not (await self.get_status())["shaders_installed"]:
                await self.install_shaders()
        except Exception as e:  # noqa: BLE001 - must not break plugin load
            decky.logger.error("DeckyCRT auto-install failed: %s", e)
        try:
            await self.migrate_params()
        except Exception as e:  # noqa: BLE001
            decky.logger.error("DeckyCRT param migration failed: %s", e)
        try:
            await self.ensure_pack_headers()
        except Exception as e:  # noqa: BLE001
            decky.logger.error("DeckyCRT pack header check failed: %s", e)

    async def _unload(self):
        decky.logger.info("DeckyCRT backend unloaded.")

    async def _uninstall(self):
        decky.logger.info("DeckyCRT uninstalled.")
