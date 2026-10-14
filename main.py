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
import subprocess
import tempfile
import urllib.request
import zipfile

import decky

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
# Bump when _parse_uniforms' range rules change: stored community params were
# derived by the old rules and would otherwise keep poisoning the panel.
PARAMS_REV = 2
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


PRESETS = [
    {
        "id": "scanlines",
        "name": "Scanlines",
        "description": "Clean dark scanlines. Cheapest option, suits any game.",
        "file": LIGHT_SUBDIR + "/scanlines.fx",
        "heavy": False,
        "params": [_param("ScanIntensity", "Scanline intensity", 0.40)],
    },
    {
        "id": "aperture-grille",
        "name": "Aperture grille",
        "description": "Trinitron-style vertical RGB stripes plus scanlines.",
        "file": LIGHT_SUBDIR + "/aperture-grille.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.35),
            _param("MaskStrength", "Grille strength", 0.30),
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
            _param("MaskStrength", "Mask strength", 0.35),
            _param("Curvature", "Screen curvature", 0.10, maxv=0.30, step=0.01),
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
            _param("MaskStrength", "Mask strength", 0.35),
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
            _param("MaskStrength", "Mask strength", 0.40),
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
            _param("MaskStrength", "Grille strength", 0.45),
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
            _param("MaskStrength", "Mask strength", 0.50),
            _param("Curvature", "Screen curvature", 0.14, maxv=0.30, step=0.01),
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
            _param("MaskStrength", "Grille strength", 0.35),
            _param("Curvature", "Screen curvature", 0.12, maxv=0.30, step=0.01),
        ],
    },
    {
        "id": "crt-pro",
        "name": "CRT Pro",
        "description": ("Two-pass aperture grille: a blurred halation pass, "
                        "then beam profile, triad mask and curvature."),
        "file": LIGHT_SUBDIR + "/crt-pro.fx",
        "heavy": False,
        "params": [
            _param("ScanIntensity", "Scanline intensity", 0.35),
            _param("MaskStrength", "Grille strength", 0.25),
            _param("GlowAmount", "Glow", 0.15),
            _param("Curvature", "Screen curvature", 0.10, maxv=0.30,
                   step=0.01),
            _param("BeamWidth", "Beam width", 0.50, minv=0.05, maxv=0.90,
                   step=0.01),
            _param("Vignette", "Vignette", 0.20),
            _param("Sharpness", "Sharpness", 0.25),
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
    def __init__(self):
        # A toggle and a shader reapply must not race on Gamescope's one effect
        # property. This is per backend instance and local to this plugin.
        self._effect_lock = asyncio.Lock()

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
        if preset["heavy"]:
            return cfg.get("heavy_relpath", "")
        return preset["file"]

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
            if name.endswith(".fx"):
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

    def _parse_uniforms(self, text: str, limit: int = 10) -> list:
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
            if len(params) >= limit:
                break
        return params

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
            relpath = cp.get("relpath") or cp.get("file")
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

    @staticmethod
    def _parse_core_line(line: str) -> str | None:
        """PID from a `coredumpctl list` row, or None if it is not a core row.

        The timestamp has a variable number of words (weekday, date, time,
        timezone), so the PID is matched as the number preceding the three
        numeric columns that follow it, not by position.
        """
        m = re.search(r"\b(\d{1,7})\s+\d+\s+\d+\s+SIG[A-Z]+\b", line)
        return m.group(1) if m else None

    @staticmethod
    def _wrapper_appid_from_cmdline(cmdline: str) -> int | None:
        """App id when a gamescope command line is one of OUR per-game wrappers."""
        if "--reshade-effect" not in cmdline or "deckycrt" not in cmdline:
            return None
        m = re.search(r"AppId=(\d+)", cmdline)
        return int(m.group(1)) if m else None

    def _wrapped_running_apps(self) -> list | None:
        """Apps running RIGHT NOW under our nested gamescope.

        This is how the panel can tell "the per-game filter is live in this
        process" from "a wrapper is merely saved for next launch" — the two
        look identical in Steam's saved options, and only the first one means
        system-wide would filter the same pixels twice.
        """
        found = set()
        try:
            p = subprocess.run(["ps", "-eo", "args"], capture_output=True,
                               text=True, timeout=10, check=False)
        except (OSError, subprocess.TimeoutExpired) as e:
            decky.logger.error("DeckyCRT: wrapped-app probe failed: %s", e)
            return None
        if p.returncode != 0:
            decky.logger.error("DeckyCRT: wrapped-app probe exited %s: %s",
                               p.returncode, (p.stderr or "")[:200])
            return None
        for line in p.stdout.splitlines():
            app_id = self._wrapper_appid_from_cmdline(line)
            if app_id is not None:
                found.add(app_id)
        return sorted(found)

    async def wrapped_running_apps(self) -> dict:
        app_ids = self._wrapped_running_apps()
        if app_ids is None:
            return {"ok": False,
                    "detail": "Could not determine whether a wrapped game is running.",
                    "app_ids": []}
        return {"ok": True, "app_ids": app_ids}

    def _gamescope_core_pids(self, since: str) -> list:
        if not shutil.which("coredumpctl"):
            return []
        try:
            p = subprocess.run(["coredumpctl", "list", "--no-pager",
                                "--since", since],
                               capture_output=True, text=True, timeout=25)
        except (OSError, subprocess.TimeoutExpired):
            return []
        pids = []
        for line in p.stdout.splitlines():
            if "gamescope" not in line:
                continue
            pid = self._parse_core_line(line)
            if pid:
                pids.append(pid)
        return pids

    def _core_cmdline(self, pid: str) -> str:
        try:
            p = subprocess.run(["coredumpctl", "info", pid, "--no-pager"],
                               capture_output=True, text=True, timeout=25)
        except (OSError, subprocess.TimeoutExpired):
            return ""
        lines = p.stdout.splitlines()
        for i, line in enumerate(lines):
            if "Command Line:" not in line:
                continue
            chunk = [line.split("Command Line:", 1)[1]]
            # The command line can wrap; stop at the next field.
            for nxt in lines[i + 1:]:
                if ":" in nxt and nxt.strip().split(":", 1)[0].isalpha():
                    break
                chunk.append(nxt)
            return " ".join(chunk)
        return ""

    async def check_wrapper_crashes(self) -> dict:
        """Detect a game whose launch died with gamescope and report it.

        A per-game wrapper puts gamescope in the launch path of the game, so a
        gamescope crash there means the game never starts — which reads to the
        user as "this game will not launch any more". The core dump names both
        the wrapper and the app id, so the panel can strip exactly the wrapper
        that is doing it instead of leaving the game unlaunchable.
        """
        cfg = self._load_config()
        managed = cfg.get("managed_apps") or {}
        if not managed:
            return {"ok": True, "crashes": []}
        seen = {str(x) for x in (cfg.get("crash_scan_seen") or [])}
        crashes = []
        new_pids = []
        for pid in self._gamescope_core_pids("3 days ago"):
            if pid in seen:
                continue
            new_pids.append(pid)
            cmdline = self._core_cmdline(pid)
            app_id = self._wrapper_appid_from_cmdline(cmdline)
            if app_id is None or str(app_id) not in managed:
                continue
            entry = managed[str(app_id)]
            crashes.append({
                "app_id": app_id,
                "name": entry.get("name") or f"App {app_id}",
                "shader": entry.get("relpath") or "",
            })
        if new_pids:
            cfg["crash_scan_seen"] = (sorted(seen | set(new_pids)))[-50:]
            self._save_config(cfg)
        if crashes:
            decky.logger.error(
                "DeckyCRT: gamescope crashed launching %s under a per-game "
                "wrapper; the wrapper should be removed",
                ", ".join(str(c["app_id"]) for c in crashes))
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

    # ------------------------------------------------------------------ status
    async def get_status(self) -> dict:
        cfg = self._load_config()
        live_effect = self._live_global_effect()
        presets = []
        for p in PRESETS:
            entry = dict(p)
            entry["relpath"] = self._resolve_relpath(p, cfg)
            if p["heavy"] and not entry["relpath"]:
                entry["relpath"] = ""
            presets.append(entry)
        for cp in cfg.get("community_presets", []):
            entry = dict(cp)
            entry["community"] = True
            presets.append(entry)
        light_dir = os.path.join(self._shader_base, LIGHT_SUBDIR)
        shaders_installed = os.path.isdir(light_dir) and any(
            n.endswith(".fx") for n in os.listdir(light_dir))
        return {
            "reshade_supported": self._gamescope_reshade_supported(),
            "xprop_available": self._xprop_available(),
            "displays": self._x11_displays(),
            "shaders_installed": shaders_installed,
            "heavy_installed": bool(cfg.get("heavy_relpath")),
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
        gs = shutil.which("gamescope")
        if not gs:
            return False
        try:
            p = subprocess.run([gs, "--help"], capture_output=True, text=True,
                               timeout=15)
            out = (p.stdout + p.stderr).lower()
            return "reshade" in out
        except (OSError, subprocess.TimeoutExpired):
            return False

    def _x11_displays(self) -> list:
        d = "/tmp/.X11-unix"
        out = []
        try:
            for name in os.listdir(d):
                if name.startswith("X") and name[1:].isdigit():
                    out.append(":" + name[1:])
        except OSError:
            pass
        return out

    def _display_owner(self, display: str) -> str | None:
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

    def _xprop(self, display: str, *args: str):
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
            p = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=10, env=env)
            return p.returncode, (p.stdout + p.stderr).strip()
        except (OSError, subprocess.TimeoutExpired) as e:
            return 1, str(e)

    def _gamescope_displays(self) -> list:
        """Displays that really carry Gamescope's reshade property.

        Other Xwayland servers in the session answer xprop but have no
        GAMESCOPE_* properties, so writing to them silently does nothing.
        """
        found = []
        for display in self._x11_displays():
            rc, out = self._xprop(display, "-notype",
                                  "GAMESCOPE_RESHADE_EFFECT")
            if rc == 0 and "not found" not in out:
                found.append(display)
        return found

    @staticmethod
    def _parse_effect_property(output: str) -> tuple[bool, str]:
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

    def _live_global_effect(self) -> str | None:
        """Return the exact live effect path; None means unreadable."""
        displays = self._gamescope_displays()
        if not displays:
            return None
        for display in displays:
            rc, output = self._xprop(display, "-notype",
                                     "GAMESCOPE_RESHADE_EFFECT")
            if rc != 0:
                continue
            readable, effect = self._parse_effect_property(output)
            if readable:
                return effect
        return None


    async def _read_effect_until(self, expected: str, displays: list) -> tuple[bool, str]:
        """Poll readback: xprop's write can precede Gamescope's render tick."""
        last = ""
        for attempt in range(16):
            readable_any = False
            for display in displays:
                rc, output = self._xprop(display, "-notype",
                                         "GAMESCOPE_RESHADE_EFFECT")
                if rc != 0:
                    last = output
                    continue
                readable, observed = self._parse_effect_property(output)
                if not readable:
                    last = f"{display}: unparseable property readback: {output}"
                    continue
                readable_any = True
                if observed == expected:
                    return True, display
                last = f"{display}: still {observed!r}"
            if attempt < 15 and readable_any:
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
        if shutil.which("xprop") is None:
            return {"ok": False,
                    "detail": "xprop is not installed; global mode unavailable."}
        displays = self._gamescope_displays()
        if not displays:
            return {"ok": False,
                    "detail": "No Gamescope display reachable over xprop."}
        expected = relpath if enabled else ""
        last_error = ""
        for display in displays:
            rc, output = self._xprop(
                display, "-f", "GAMESCOPE_RESHADE_EFFECT", "8s", "-set",
                "GAMESCOPE_RESHADE_EFFECT", expected)
            if rc != 0:
                last_error = output
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

    def _xprop_available(self) -> bool:
        return (shutil.which("xprop") is not None
                and bool(self._gamescope_displays()))

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
