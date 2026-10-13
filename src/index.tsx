import { useEffect, useRef, useState } from "react";
import { FaTv } from "react-icons/fa";
import {
  ButtonItem,
  DropdownItem,
  PanelSection,
  PanelSectionRow,
  SliderField,
  staticClasses,
} from "@decky/ui";
import { definePlugin, toaster } from "@decky/api";
import {
  ManagedApp,
  PresetParam,
  StatusInfo,
  clearManagedApps,
  downloadHeavy,
  downloadPack,
  getStatus,
  installShaders,
  removePack,
  setGlobalEnabled,
  setManagedApp,
  setParam,
  setPreset,
} from "./api";
import { installWrapper, removeWrapper, wrapperPath } from "./launchOptions";
import {
  Capabilities,
  RunningApp,
  capabilities,
  log,
  readLaunchOptions,
  readRunningApp,
  writeLaunchOptions,
} from "./steam";

type FilterMode = "off" | "app" | "system";

function toast(body: string) {
  toaster.toast({ title: "DeckyCRT", body });
}

// A rejected backend call must never surface as a raw panel error — that is
// what the "an error occurred in DeckyCRT" banner actually is.
function toastError(what: string, e: unknown) {
  toast(`${what} failed — see the plugin log`);
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

function shaderPathFor(status: StatusInfo, presetId?: string): string {
  const id = presetId ?? status.preset_id;
  return status.presets.find((p) => p.id === id)?.relpath ?? "";
}

function Content() {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [runningApp, setRunningApp] = useState<RunningApp | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  // null = the running game's options could not be read; do not guess "off".
  const [runningWrapper, setRunningWrapper] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = async (): Promise<StatusInfo | null> => {
    try {
      const s = await getStatus();
      setStatus(s);
      return s;
    } catch (e) {
      toastError("Status refresh", e);
      return null;
    }
  };

  const refreshRunningWrapper = async (app: RunningApp | null) => {
    if (!app) {
      setRunningWrapper(null);
      return;
    }
    const cur = await readLaunchOptions(app.appId);
    const path = cur === null ? null : wrapperPath(cur);
    setRunningWrapper(path);
    log(
      `running app ${app.appId} (${app.name}) launch options ` +
        (cur === null ? "unreadable" : JSON.stringify(cur))
    );
  };

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

    // GameSessions.RegisterForAppLifetimeNotifications rejects with "Unknown
    // method" on this Steam build despite existing, so poll the Router store
    // the way the other working plugins here do. Coalesce and only update when
    // the app actually changes.
    setCaps(capabilities());
    const poll = () => {
      const app = readRunningApp();
      setRunningApp((current) =>
        current?.appId === app?.appId && current?.name === app?.name
          ? current
          : app
      );
    };
    poll();
    const interval = globalThis.setInterval(poll, 1500);
    return () => globalThis.clearInterval(interval);
  }, []);

  // Re-read the wrapper state whenever the foreground app changes.
  useEffect(() => {
    void refreshRunningWrapper(runningApp);
  }, [runningApp]);

  if (!status) {
    return (
      <PanelSection title="DeckyCRT">
        <PanelSectionRow>
          <div>Loading…</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  const managed = status.managed_apps ?? {};
  const managedEntries = Object.entries(managed);
  const managedCount = managedEntries.length;
  const appScoped = runningWrapper !== null || managedCount > 0;
  // One source of truth: the live session property plus the wrappers actually
  // saved in Steam. No separate "current mode" flag that can drift.
  const filterMode: FilterMode = status.global_enabled
    ? "system"
    : appScoped
      ? "app"
      : "off";
  const currentPreset = status.presets.find((p) => p.id === status.preset_id);
  const currentParams =
    currentPreset && status.params[currentPreset.id]
      ? status.params[currentPreset.id]
      : {};
  const presetOptions = status.presets.map((p) => ({
    data: p.id,
    label: p.name + (p.heavy ? " (heavy)" : ""),
  }));

  /**
   * Install or strip the wrapper for one game, then record it.
   *
   * `prior` carries the stored added_command flag: removal needs it to take
   * back the `%command%` we synthesized, and a preset change must not clear it.
   */
  const applyWrapper = async (
    appId: number,
    name: string,
    enable: boolean,
    rel: string,
    prior?: ManagedApp
  ): Promise<boolean> => {
    const cur = await readLaunchOptions(appId);
    if (cur === null) {
      log(`cannot read launch options for ${appId} (${name}) — not touching`);
      return false;
    }
    if (enable) {
      if (!rel) {
        log("no shader path for the selected preset — cannot enable");
        return false;
      }
      const res = installWrapper(cur, rel);
      if (res.blocked === "foreign-gamescope") {
        log(`${appId} already has a gamescope wrapper — refusing to stack`);
        return false;
      }
      const tracked = prior?.added_command === true;
      if (!res.changed) {
        // Already wrapped with this path; just make sure it is tracked.
        await setManagedApp(appId, name, rel, true, tracked);
        return true;
      }
      const ok = await writeLaunchOptions(appId, res.options);
      if (ok) {
        await setManagedApp(appId, name, rel, true, res.addedCommand ?? tracked);
      }
      return ok;
    }
    const res = removeWrapper(cur, prior?.added_command === true);
    if (!res.changed) {
      await setManagedApp(appId, name, rel, false, false);
      return true;
    }
    const ok = await writeLaunchOptions(appId, res.options);
    if (ok) await setManagedApp(appId, name, rel, false, false);
    return ok;
  };

  /** Strip the per-game wrapper everywhere it is known to be. */
  const clearAppScope = async (rel: string): Promise<boolean> => {
    const targets: Array<{ appId: number; name: string }> = [];
    if (runningApp) targets.push(runningApp);
    for (const [id, info] of managedEntries) {
      const appId = Number(id);
      if (!Number.isFinite(appId) || appId <= 0) continue;
      if (targets.some((t) => t.appId === appId)) continue;
      targets.push({ appId, name: info.name });
    }
    let ok = true;
    for (const t of targets) {
      if (!(await applyWrapper(t.appId, t.name, false, rel, managed[String(t.appId)]))) {
        ok = false;
      }
    }
    if (ok) await clearManagedApps();
    return ok;
  };

  const handleModeChange = async (mode: FilterMode) => {
    if (busy || mode === filterMode) return;
    setBusy(true);
    const rel = shaderPathFor(status);
    log(`mode -> ${mode} (preset ${status.preset_id}, shader ${rel || "none"})`);
    try {
      if (mode === "off") {
        const cleared = await clearAppScope(rel);
        let detail = "CRT filter off.";
        if (status.global_enabled) {
          const res = await setGlobalEnabled(false);
          detail = res.ok ? "CRT filter off." : res.detail;
        }
        if (!cleared) {
          detail +=
            " Some saved per-game wrappers could not be read or cleared — see the plugin log.";
        }
        toast(detail);
      } else if (mode === "system") {
        const cleared = await clearAppScope(rel);
        if (!cleared) {
          toast(
            "Couldn't clear every saved per-game wrapper, so system-wide was not enabled — they must not stack."
          );
          return;
        }
        const res = await setGlobalEnabled(true);
        toast(res.detail);
      } else {
        // Active app: the wrapper lives in that game's saved launch options.
        // It cannot filter a game that is already running.
        if (!runningApp) {
          toast(
            "Start a game first — active-app mode saves the filter in that game's launch options."
          );
          return;
        }
        if (status.global_enabled) {
          const res = await setGlobalEnabled(false);
          if (!res.ok) {
            toast(res.detail);
            return;
          }
        }
        const ok = await applyWrapper(
          runningApp.appId,
          runningApp.name,
          true,
          rel,
          managed[String(runningApp.appId)]
        );
        toast(
          ok
            ? `Saved for ${runningApp.name}. It applies the next time that game starts.`
            : `Couldn't save launch options for ${runningApp.name} — nothing changed. See the plugin log.`
        );
      }
    } catch (e) {
      toastError("Mode change", e);
    } finally {
      await refresh();
      await refreshRunningWrapper(runningApp);
      setBusy(false);
    }
  };

  const handlePreset = async (presetId: string) => {
    try {
      const res = await setPreset(presetId);
      if (!res.ok) {
        toast(res.detail);
        return;
      }
      const fresh = await refresh();
      if (!fresh) return;
      // Saved wrappers point at a path; a preset change has to re-point them
      // or the game keeps launching the old shader.
      const tracked = Object.entries(fresh.managed_apps ?? {});
      if (!tracked.length) return;
      const rel = shaderPathFor(fresh);
      let ok = 0;
      for (const [id, info] of tracked) {
        const appId = Number(id);
        if (!Number.isFinite(appId) || appId <= 0) continue;
        if (await applyWrapper(appId, info.name, true, rel, info)) ok++;
      }
      if (ok !== tracked.length) {
        toast(
          `Updated the saved wrapper for ${ok} of ${tracked.length} game(s) — see the plugin log.`
        );
      } else if (ok > 0) {
        toast(`Saved wrapper re-pointed for ${ok} game(s).`);
      }
    } catch (e) {
      toastError("Preset switch", e);
    }
  };

  const handleRemoveWrappers = async () => {
    setBusy(true);
    try {
      const ok = await clearAppScope(shaderPathFor(status));
      toast(
        ok
          ? "Per-game wrappers removed."
          : "Some wrappers could not be cleared — see the plugin log."
      );
      await refresh();
      await refreshRunningWrapper(runningApp);
    } catch (e) {
      toastError("Wrapper cleanup", e);
    } finally {
      setBusy(false);
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
        if (!res.ok) toast(res.detail);
      } catch (e) {
        toastError("Slider change", e);
      }
    }, 600);
  };

  const handleDownloadHeavy = async () => {
    setBusy(true);
    try {
      const res = await downloadHeavy();
      toast(res.ok ? `Installed: ${res.relpath}` : `Failed: ${res.detail}`);
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
      toast(res.detail);
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
      toast(res.detail);
      await refresh();
    } catch (e) {
      toastError("Pack removal", e);
    }
  };

  const modeOptions = [
    { data: "off", label: "Off" },
    {
      data: "app",
      label: runningApp ? `Active app: ${runningApp.name}` : "Active app",
    },
    { data: "system", label: "System-wide" },
  ];
  const managedNames = managedEntries.map(([, info]) => info.name).join(", ");
  const modeDescription =
    filterMode === "system"
      ? runningApp
        ? `Filtering the whole screen right now, including ${runningApp.name}.`
        : "Filtering the whole screen right now, including the Steam UI."
      : filterMode === "app"
        ? runningWrapper !== null && runningApp
          ? `Saved in ${runningApp.name}'s launch options — it applies the next time that game starts, not to the copy already running.`
          : `Saved for ${managedNames}. Applies the next time each game starts.`
        : runningApp
          ? `No filter. Active app saves it for ${runningApp.name}'s next launch; System-wide filters everything now.`
          : "No filter. Start a game to use Active app, or use System-wide for the whole screen.";

  const showHeavyDownload = currentPreset?.heavy && !status.heavy_installed;

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
        <DropdownItem
          label="Filter mode"
          description={modeDescription}
          rgOptions={modeOptions}
          selectedOption={
            modeOptions.find((o) => o.data === filterMode) ?? modeOptions[0]
          }
          disabled={busy || !status.reshade_supported}
          onChange={(opt: { data: string }) =>
            handleModeChange(opt.data as FilterMode)
          }
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
        {currentPreset?.params
          ? currentPreset.params
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
              ))
          : null}
        {filterMode === "app" && (
          <PanelSectionRow>
            <div style={{ fontSize: "0.8em", opacity: 0.7 }}>
              Slider changes rewrite the shader file; a game that is already
              running keeps its compiled copy until it restarts.
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      {managedCount > 0 && (
        <PanelSection title="Saved per-game filters">
          <PanelSectionRow>
            <div style={{ fontSize: "0.85em", opacity: 0.85 }}>
              {managedNames}
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <div style={{ fontSize: "0.8em", opacity: 0.7 }}>
              These games start under Gamescope with the selected preset.
              Removing the wrappers restores each game's original launch
              options.
            </div>
          </PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy}
            onClick={handleRemoveWrappers}
          >
            {busy ? "Working…" : "Remove saved wrappers"}
          </ButtonItem>
        </PanelSection>
      )}

      {!caps?.canWriteLaunchOptions && (
        <PanelSection title="Steam integration">
          <PanelSectionRow>
            <div>
              This Steam build doesn't expose launch-option editing, so
              active-app mode is unavailable. System-wide mode still works.
            </div>
          </PanelSectionRow>
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
