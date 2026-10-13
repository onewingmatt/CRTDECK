import { useEffect, useRef, useState } from "react";
import { FaTv } from "react-icons/fa";
import {
  ButtonItem,
  DropdownItem,
  PanelSection,
  PanelSectionRow,
  SliderField,
  ToggleField,
  staticClasses,
} from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import {
  PresetParam,
  StatusInfo,
  downloadHeavy,
  downloadPack,
  getStatus,
  installShaders,
  removePack,
  setGlobalEnabled,
  setParam,
  setPreset,
} from "./api";

// Matches both deckycrt/... and deckycrt-heavy/... wrapper paths.
const WRAPPER_MARKER = "--reshade-effect deckycrt";

interface RunningApp {
  appId: number;
  name: string;
}

// Decky plugins run inside Steam's UI, where the real SteamClient is on
// window. Feature-detect everything: this build does NOT expose
// SteamClient.Apps.GetAppDetails, and calling it unguarded throws inside a
// React effect, which takes the whole panel down (the "Decky menu crashes"
// failure). Other plugins on this box (BC250-Toolkit) guard the same way.
function steamRoot(): any {
  return (window as any).SteamClient;
}

function canWatchGameSessions(): boolean {
  return (
    typeof steamRoot()?.GameSessions?.RegisterForAppLifetimeNotifications ===
    "function"
  );
}

function canReadLaunchOptions(): boolean {
  if (typeof steamRoot()?.Apps?.GetAppDetails === "function") return true;
  return typeof (window as any).appDetailsStore?.GetAppDetails === "function";
}

// Returns null when the launch options could NOT be read. Callers must never
// treat null as "" — writing "" would wipe the user's real launch options.
async function readLaunchOptions(appId: number): Promise<string | null> {
  try {
    const apps = steamRoot()?.Apps;
    if (typeof apps?.GetAppDetails === "function") {
      const d = await apps.GetAppDetails(appId);
      if (typeof d?.strLaunchOptions === "string") return d.strLaunchOptions;
    }
    const store = (window as any).appDetailsStore;
    if (typeof store?.GetAppDetails === "function") {
      if (typeof store.RequestAppDetails === "function") {
        await store.RequestAppDetails(appId);
      }
      const d2 = store.GetAppDetails(appId);
      if (typeof d2?.strLaunchOptions === "string") return d2.strLaunchOptions;
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

// A rejected backend call must never surface as a raw panel error — that is
// what the "an error occurred in DeckyCRT" banner actually is.
function toastError(what: string, e: unknown) {
  toaster.toast({
    title: "DeckyCRT",
    body: `${what} failed — see the plugin log`,
  });
  console.error("DeckyCRT:", what, e);
}

// The backend derives these ranges, but the panel must not trust any of it:
// a SliderField with a value outside [min, max] takes the whole panel down.
function paramIsUsable(p: PresetParam): boolean {
  return (
    Number.isFinite(p.min) &&
    Number.isFinite(p.max) &&
    Number.isFinite(p.step) &&
    p.max > p.min &&
    p.step > 0 &&
    p.step <= p.max - p.min
  );
}

function sliderValue(p: PresetParam, v: number | undefined): number {
  const base = typeof v === "number" && Number.isFinite(v) ? v : p.default;
  const clamped = Math.min(Math.max(base, p.min), p.max);
  return Number.isFinite(clamped) ? clamped : p.min;
}

function Content() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [runningApp, setRunningApp] = useState<RunningApp | null>(null);
  const [perGameOn, setPerGameOn] = useState(false);
  const [perGameAvailable, setPerGameAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = async () => {
    try {
      setStatus(await getStatus());
    } catch (e) {
      toastError("Status refresh", e);
    }
  };

  // Initial load: make sure shaders are installed, watch for running games.
  useEffect(() => {
    (async () => {
      try {
        let s = await getStatus();
        if (!s.shaders_installed) {
          await installShaders();
          s = await getStatus();
        }
        setStatus(s);
      } catch (e) {
        toastError("Initial load", e);
      }
    })();

    // Per-game mode needs APIs that not every Steam build exposes. Detect once;
    // never call a missing method (that is what crashes the panel).
    const canWatch = canWatchGameSessions();
    const canRead = canReadLaunchOptions();
    setPerGameAvailable(canWatch && canRead);
    if (!canWatch) return;

    let unregister: any = null;
    try {
      const register =
        steamRoot().GameSessions.RegisterForAppLifetimeNotifications;
      unregister = register((data: any) => {
        // Non-Steam shortcut appids arrive as signed int32.
        const appId = (data.unAppID as number) >>> 0;
        if (!data.bRunning) {
          setRunningApp(null);
          return;
        }
        // Only reached when the API passed detection; keep it defensive anyway.
        const apps = steamRoot()?.Apps;
        if (typeof apps?.GetAppDetails === "function") {
          Promise.resolve(apps.GetAppDetails(appId))
            .then((d: any) =>
              setRunningApp({
                appId,
                name: (d?.strDisplayName as string) ?? `App ${appId}`,
              })
            )
            .catch(() => setRunningApp({ appId, name: `App ${appId}` }));
        } else {
          setRunningApp({ appId, name: `App ${appId}` });
        }
      });
    } catch (e) {
      toastError("Game session watch", e);
    }
    return () => {
      try {
        if (typeof unregister === "function") unregister();
        else if (typeof unregister?.unregister === "function") {
          unregister.unregister();
        }
      } catch {
        /* the panel is unloading anyway */
      }
    };
  }, []);

  // Sync the per-game toggle when the running app changes.
  useEffect(() => {
    (async () => {
      if (!runningApp || !perGameAvailable) {
        setPerGameOn(false);
        return;
      }
      const cur = await readLaunchOptions(runningApp.appId);
      setPerGameOn(cur !== null && cur.includes(WRAPPER_MARKER));
    })();
  }, [runningApp, perGameAvailable]);

  const currentPreset = status?.presets.find((p) => p.id === status.preset_id);
  const currentParams =
    (status && currentPreset && status.params[currentPreset.id]) ?? {};
  const presetOptions = (status?.presets ?? []).map((p) => ({
    data: p.id,
    label: p.name + (p.heavy ? " (heavy)" : ""),
  }));

  const handlePreset = async (presetId: string) => {
    try {
      const res = await setPreset(presetId);
      if (!res.ok) {
        toaster.toast({ title: "DeckyCRT", body: res.detail });
        return;
      }
      await refresh();
    } catch (e) {
      toastError("Preset switch", e);
    }
  };

  const handleGlobalToggle = async (enable: boolean) => {
    try {
      const res = await setGlobalEnabled(enable);
      toaster.toast({ title: "DeckyCRT", body: res.detail });
      await refresh();
    } catch (e) {
      toastError("Global toggle", e);
    }
  };

  const handleSlider = (presetId: string, key: string, value: number) => {
    // Optimistic UI update; bake into the shader file after a short pause.
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            params: {
              ...prev.params,
              [presetId]: { ...prev.params[presetId], [key]: value },
            },
          }
        : prev
    );
    const timerKey = `${presetId}:${key}`;
    if (debounceTimers.current[timerKey])
      clearTimeout(debounceTimers.current[timerKey]);
    debounceTimers.current[timerKey] = setTimeout(async () => {
      try {
        const res = await setParam(presetId, key, value, true);
        if (!res.ok) toaster.toast({ title: "DeckyCRT", body: res.detail });
      } catch (e) {
        toastError("Slider change", e);
      }
    }, 600);
  };

  const handleDownloadHeavy = async () => {
    setBusy(true);
    try {
      const res = await downloadHeavy();
      toaster.toast({
        title: "DeckyCRT",
        body: res.ok ? `Installed: ${res.relpath}` : `Failed: ${res.detail}`,
      });
      await refresh();
    } catch (e) {
      toastError("Heavy shader download", e);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPack = async (packId: string) => {
    setBusy(true);
    try {
      const res = await downloadPack(packId);
      toaster.toast({ title: "DeckyCRT", body: res.detail });
      await refresh();
    } catch (e) {
      toastError("Pack download", e);
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePack = async (packId: string) => {
    try {
      const res = await removePack(packId);
      toaster.toast({ title: "DeckyCRT", body: res.detail });
      await refresh();
    } catch (e) {
      toastError("Pack removal", e);
    }
  };

  const handlePerGame = async (enable: boolean) => {
    if (!runningApp || !status) return;
    if (!perGameAvailable) {
      toaster.toast({
        title: "DeckyCRT",
        body: "This Steam build doesn't expose app launch options.",
      });
      return;
    }
    const rel =
      status.presets.find((p) => p.id === status.preset_id)?.relpath ?? "";
    if (enable && !rel) {
      toaster.toast({
        title: "DeckyCRT",
        body: "Download the heavy shaders first (button above).",
      });
      return;
    }
    const cur = await readLaunchOptions(runningApp.appId);
    if (cur === null) {
      // Never write on an unreadable value — it would wipe the user's options.
      toaster.toast({
        title: "DeckyCRT",
        body: "Couldn't read this game's launch options — nothing changed.",
      });
      return;
    }
    let next = cur;
    if (enable) {
      if (cur.includes(WRAPPER_MARKER)) {
        setPerGameOn(true);
        return;
      }
      const wrapper = `gamescope --reshade-effect ${rel} -- `;
      next = cur ? wrapper + cur : wrapper + "%command%";
    } else {
      if (!cur.includes(WRAPPER_MARKER)) {
        setPerGameOn(false);
        return;
      }
      next = cur.replace(/^gamescope --reshade-effect \S+ -- /, "");
    }
    const setLaunchOptions = steamRoot()?.Apps?.SetAppLaunchOptions;
    if (typeof setLaunchOptions !== "function") {
      toaster.toast({
        title: "DeckyCRT",
        body: "This Steam build doesn't allow changing launch options.",
      });
      return;
    }
    try {
      await setLaunchOptions(runningApp.appId, next);
      let confirmed = false;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if ((await readLaunchOptions(runningApp.appId)) === next) {
          confirmed = true;
          break;
        }
      }
      const after = await readLaunchOptions(runningApp.appId);
      setPerGameOn(after !== null && after.includes(WRAPPER_MARKER));
      if (!confirmed)
        toaster.toast({
          title: "DeckyCRT",
          body: "Steam didn't confirm the launch options change.",
        });
    } catch {
      toaster.toast({ title: "DeckyCRT", body: "Failed to update launch options." });
    }
  };

  if (!status) {
    return (
      <PanelSection title="DeckyCRT">
        <PanelSectionRow>
          <div>Loading…</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const showHeavyDownload =
    currentPreset?.heavy && !status.heavy_installed;

  return (
    <>
      <PanelSection title="CRT filter">
        {!status.reshade_supported && (
          <PanelSectionRow>
            <div>
              Gamescope ReShade support not detected. Shaders can't be applied
              on this system.
            </div>
          </PanelSectionRow>
        )}
        <ToggleField
          label="Global CRT (whole screen)"
          description={
            status.xprop_available
              ? "Applies the shader to the entire Gamescope session."
              : "Unavailable: needs xprop in this session."
          }
          checked={status.global_enabled}
          disabled={!status.xprop_available || !status.reshade_supported}
          onChange={handleGlobalToggle}
        />
        <DropdownItem
          label="Preset"
          rgOptions={presetOptions}
          selectedOption={
            presetOptions.find((o) => o.data === status.preset_id) ??
            presetOptions[0]
          }
          onChange={(opt: { data: string }) => handlePreset(opt.data)}
        />
        {currentPreset && (
          <PanelSectionRow>
            <div style={{ fontSize: "0.85em", opacity: 0.8 }}>
              {currentPreset.description}
            </div>
          </PanelSectionRow>
        )}
        {showHeavyDownload && (
          <ButtonItem layout="below" onClick={handleDownloadHeavy} disabled={busy}>
            {busy ? "Downloading…" : "Download CRT-Royale (heavy)"}
          </ButtonItem>
        )}
        {(currentPreset?.params ?? [])
          .filter(paramIsUsable)
          .slice(0, 12)
          .map((param) => (
            <SliderField
              key={param.key}
              label={param.label}
              min={param.min}
              max={param.max}
              step={param.step}
              value={sliderValue(param, currentParams[param.key])}
              onChange={(v: number) =>
                handleSlider(status.preset_id, param.key, v)
              }
            />
          ))}
        <PanelSectionRow>
          <div style={{ fontSize: "0.8em", opacity: 0.7 }}>
            Global and per-game stack — use one or the other, not both.
          </div>
        </PanelSectionRow>
      </PanelSection>

      {runningApp && (
        <PanelSection title="This game">
          <ToggleField
            label={runningApp.name}
            description={
              perGameAvailable
                ? "Wrap this game's launch options in Gamescope + CRT."
                : "Unavailable: this Steam build doesn't expose app launch options."
            }
            checked={perGameOn}
            disabled={!status.reshade_supported || !perGameAvailable}
            onChange={handlePerGame}
          />
        </PanelSection>
      )}

      <PanelSection title="Community packs">
        <PanelSectionRow>
          <div style={{ fontSize: "0.85em", opacity: 0.8 }}>
            Curated shader collections from the community. Experimental — some
            shaders may not compile on your Gamescope build. New presets appear
            in the list above after downloading.
          </div>
        </PanelSectionRow>
        {status.community_packs.map((pack) => (
          <div key={pack.id}>
            <PanelSectionRow>
              <div style={{ fontSize: "0.9em" }}>
                <div>{pack.name}</div>
                <div style={{ opacity: 0.7, fontSize: "0.9em" }}>
                  {pack.description}
                </div>
              </div>
            </PanelSectionRow>
            <ButtonItem
              layout="below"
              disabled={busy}
              onClick={() =>
                pack.installed
                  ? handleRemovePack(pack.id)
                  : handleDownloadPack(pack.id)
              }
            >
              {busy
                ? "Working…"
                : pack.installed
                  ? `Remove ${pack.name}`
                  : `Download ${pack.name}`}
            </ButtonItem>
          </div>
        ))}
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  return {
    name: "DeckyCRT",
    titleView: <div className={staticClasses.Title}>DeckyCRT</div>,
    content: <Content />,
    icon: <FaTv />,
    onDismount() {},
  };
});
