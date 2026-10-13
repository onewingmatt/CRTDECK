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
    const details = await SteamClient.Apps.GetAppDetails(appId);
    return (details?.strLaunchOptions as string) ?? "";
  } catch {
    return "";
  }
}

function Content() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [runningApp, setRunningApp] = useState<RunningApp | null>(null);
  const [perGameOn, setPerGameOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = async () => setStatus(await getStatus());

  // Initial load: make sure shaders are installed, watch for running games.
  useEffect(() => {
    (async () => {
      let s = await getStatus();
      if (!s.shaders_installed) {
        await installShaders();
        s = await getStatus();
      }
      setStatus(s);
    })();

    const unregister =
      SteamClient.GameSessions.RegisterForAppLifetimeNotifications(
        (data: any) => {
          // Non-Steam shortcut appids arrive as signed int32.
          const appId = (data.unAppID as number) >>> 0;
          if (data.bRunning) {
            SteamClient.Apps.GetAppDetails(appId)
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
    return () => unregister();
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
    const res = await setPreset(presetId);
    if (!res.ok) {
      toaster.toast({ title: "DeckyCRT", body: res.detail });
      return;
    }
    await refresh();
  };

  const handleGlobalToggle = async (enable: boolean) => {
    const res = await setGlobalEnabled(enable);
    toaster.toast({ title: "DeckyCRT", body: res.detail });
    await refresh();
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
      const res = await setParam(presetId, key, value, true);
      if (!res.ok) toaster.toast({ title: "DeckyCRT", body: res.detail });
    }, 600);
  };

  const handleDownloadHeavy = async () => {
    setBusy(true);
    const res = await downloadHeavy();
    setBusy(false);
    toaster.toast({
      title: "DeckyCRT",
      body: res.ok ? `Installed: ${res.relpath}` : `Failed: ${res.detail}`,
    });
    await refresh();
  };

  const handleDownloadPack = async (packId: string) => {
    setBusy(true);
    const res = await downloadPack(packId);
    setBusy(false);
    toaster.toast({ title: "DeckyCRT", body: res.detail });
    await refresh();
  };

  const handleRemovePack = async (packId: string) => {
    const res = await removePack(packId);
    toaster.toast({ title: "DeckyCRT", body: res.detail });
    await refresh();
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
          selectedOption={presetOptions.find((o) => o.data === status.preset_id)}
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
        {currentPreset?.params.map((param) => (
          <SliderField
            key={param.key}
            label={param.label}
            min={param.min}
            max={param.max}
            step={param.step}
            value={currentParams[param.key] ?? param.default}
            onChange={(v: number) => handleSlider(currentPreset.id, param.key, v)}
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
