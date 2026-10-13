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

async function readLaunchOptions(appId: number): Promise<string> {
  try {
    // @decky/ui's SteamClient types omit Apps.GetAppDetails; it exists at
    // runtime, so cast rather than redeclaring the whole global as any.
    const details = await (SteamClient.Apps as any).GetAppDetails(appId);
    return (details?.strLaunchOptions as string) ?? "";
  } catch {
    return "";
  }
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

    const unregister =
      SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
        (data: any) => {
          // Non-Steam shortcut appids arrive as signed int32.
          const appId = (data.unAppID as number) >>> 0;
          if (data.bRunning) {
            (SteamClient.Apps as any)
              .GetAppDetails(appId)
              .then((d: any) =>
                setRunningApp({
                  appId,
                  name: (d?.strDisplayName as string) ?? `App ${appId}`,
                })
              )
              .catch(() => setRunningApp({ appId, name: `App ${appId}` }));
          } else {
            setRunningApp(null);
          }
        }
      );
    // @decky/ui types this as Unregisterable, which is not callable.
    return () => (unregister as unknown as () => void)();
  }, []);

  // Sync the per-game toggle when the running app changes.
  useEffect(() => {
    (async () => {
      if (!runningApp) {
        setPerGameOn(false);
        return;
      }
      setPerGameOn((await readLaunchOptions(runningApp.appId)).includes(WRAPPER_MARKER));
    })();
  }, [runningApp]);

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
    try {
      await SteamClient.Apps.SetAppLaunchOptions(runningApp.appId, next);
      let confirmed = false;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 300));
        if ((await readLaunchOptions(runningApp.appId)) === next) {
          confirmed = true;
          break;
        }
      }
      setPerGameOn((await readLaunchOptions(runningApp.appId)).includes(WRAPPER_MARKER));
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
            description="Wrap this game's launch options in Gamescope + CRT."
            checked={perGameOn}
            disabled={!status.reshade_supported}
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
