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
  checkWrapperCrashes,
  clearManagedApps,
  downloadHeavy,
  downloadPack,
  getDiagnostics,
  getStatus,
  installShaders,
  note,
  removePack,
  setGlobalEnabled,
  setManagedApp,
  setParam,
  setPreset,
  wrappedRunningApps,
} from "./api";
import { installWrapper, removeWrapper, wrapperPath } from "./launchOptions";
import { describeApps, planModeChange, readMode } from "./mode";
import type { FilterMode, ModeFacts, Step } from "./mode";
import {
  Capabilities,
  RunningApp,
  capabilities,
  log,
  readLaunchOptions,
  readRunningApp,
  writeLaunchOptions,
} from "./steam";
import { PLUGIN_BUILD } from "./version";

function toast(body: string) {
  toaster.toast({ title: "DeckyCRT", body });
}

/**
 * A mode change that "does nothing" otherwise leaves no trace the user can
 * look at. Every decision goes to Steam's CEF console AND to the plugin's own
 * log file (through the backend), because the CEF console is not reliably
 * written to disk and a deployed fix that never ran is indistinguishable from
 * one that ran and failed.
 */
function diag(message: string) {
  log(message);
  void note(message).catch(() => undefined);
}

// A rejected backend call must never surface as a raw panel error — that is
// what the "an error occurred in DeckyCRT" banner actually is.
function toastError(what: string, e: unknown) {
  toast(`${what} failed — see the plugin log`);
  diag(`${what} failed: ${String(e)}`);
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
  // The foreground game's saved wrapper. `unreadable` stays distinct from
  // `no-game`: collapsing them is how the panel guesses, and the guess is what
  // puts two filters on one picture.
  const [runningWrapper, setRunningWrapper] = useState<
    { state: "no-game" } | { state: "unreadable" } | { state: "read"; path: string }
  >({ state: "no-game" });
  const [busy, setBusy] = useState(false);
  const [recoveryRan, setRecoveryRan] = useState(false);
  const [diagRows, setDiagRows] = useState<
    Array<{ label: string; value: string }> | null
  >(null);
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
      setRunningWrapper({ state: "no-game" });
      return;
    }
    const cur = await readLaunchOptions(app.appId);
    setRunningWrapper(
      cur === null
        ? { state: "unreadable" }
        : { state: "read", path: wrapperPath(cur) ?? "" }
    );
    diag(
      `running app ${app.appId} (${app.name}) options ` +
        (cur === null ? "unreadable" : JSON.stringify(cur))
    );
  };

  // ------------------------------------------------------------- operations
  // Declared before the effects and before the loading return: the effect that
  // fires on the render where the first status arrives must not reach a
  // temporal-dead-zone binding. Nothing here reads the derived values below,
  // so every one of these is safe to call from that effect.

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
      diag(`cannot read launch options for ${appId} (${name}) — not touching`);
      return false;
    }
    if (enable) {
      if (!rel) {
        diag("no shader path for the selected preset — cannot enable");
        return false;
      }
      const res = installWrapper(cur, rel);
      if (res.blocked === "foreign-gamescope") {
        diag(`${appId} already has a gamescope wrapper — refusing to stack`);
        return false;
      }
      const tracked = prior?.added_command === true;
      if (!res.changed) {
        // Already wrapped with this path; just make sure it is tracked.
        await setManagedApp(appId, name, rel, true, tracked);
        return true;
      }
      const ok = await writeLaunchOptions(appId, res.options);
      diag(
        `wrap ${appId} (${name}): ${JSON.stringify(cur)} -> ` +
          `${JSON.stringify(res.options)} ok=${ok}`
      );
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
    diag(
      `unwrap ${appId} (${name}): ${JSON.stringify(cur)} -> ` +
        `${JSON.stringify(res.options)} ok=${ok}`
    );
    if (ok) await setManagedApp(appId, name, rel, false, false);
    return ok;
  };

  /** Strip the per-game wrapper everywhere it is known to be. */
  const clearAppScope = async (rel: string): Promise<boolean> => {
    const managed = status?.managed_apps ?? {};
    const targets: Array<{ appId: number; name: string }> = [];
    if (runningApp) targets.push(runningApp);
    for (const [id, info] of Object.entries(managed)) {
      const appId = Number(id);
      if (!Number.isFinite(appId) || appId <= 0) continue;
      if (targets.some((t) => t.appId === appId)) continue;
      targets.push({ appId, name: info.name });
    }
    let ok = true;
    for (const t of targets) {
      if (
        !(await applyWrapper(t.appId, t.name, false, rel, managed[String(t.appId)]))
      ) {
        ok = false;
      }
    }
    if (ok) await clearManagedApps();
    return ok;
  };

  /**
   * Rescue a game whose launch died with gamescope.
   *
   * The wrapper puts gamescope in the game's launch path, so a crash there
   * means the game never starts at all — which reads to the user as "this game
   * won't launch any more". The core dump names the app id, so the wrapper
   * that did it can be removed instead of leaving the game unlaunchable.
   */
  const recoverFromWrapperCrashes = async (s: StatusInfo): Promise<boolean> => {
    const managed = s.managed_apps ?? {};
    if (!Object.keys(managed).length) return false;
    let res;
    try {
      res = await checkWrapperCrashes();
    } catch (e) {
      toastError("Wrapper crash check", e);
      return false;
    }
    if (!res?.crashes?.length) {
      // A scan that could not run is not "no crashes". Staying silent here is
      // how a game sits unlaunchable while every check reports all clear.
      if (res && res.ok === false) {
        diag(`crash scan could not run: ${res.detail ?? "no detail"}`);
        toast(
          "Couldn't check whether a saved CRT wrapper is stopping a game from launching — see the plugin log."
        );
      }
      return false;
    }
    const rel = shaderPathFor(s);
    const cleaned: string[] = [];
    const stuck: string[] = [];
    for (const crash of res.crashes) {
      const ok = await applyWrapper(
        crash.app_id,
        crash.name,
        false,
        rel,
        managed[String(crash.app_id)]
      );
      diag(
        `crash recovery: wrapper for ${crash.app_id} (${crash.name}, ` +
          `${crash.shader}) ${ok ? "removed" : "COULD NOT BE REMOVED"}`
      );
      if (ok && !cleaned.includes(crash.name)) cleaned.push(crash.name);
      if (!ok && !stuck.includes(crash.name)) stuck.push(crash.name);
    }
    if (cleaned.length) {
      toast(
        `Gamescope crashed starting ${cleaned.join(", ")} under a saved CRT wrapper — the wrapper was removed, so the game launches normally again.`
      );
    }
    if (stuck.length) {
      toast(
        `Couldn't remove the saved wrapper for ${stuck.join(", ")} — see the plugin log.`
      );
    }
    return cleaned.length > 0;
  };

  // Shared synchronous guard for every operation that mutates filter state.
  // React's busy state update is asynchronous and cannot serialize rapid events.
  const modeBusyRef = useRef(false);

  /**
   * Everything the mode decision needs, gathered in one place.
   *
   * A `null` field means "could not be read", which is a different answer from
   * "nothing there". Keeping them apart is the whole point: the old code
   * guessed, and the guess is what stacks two filters on one picture.
   */
  const gatherModeFacts = async (): Promise<ModeFacts> => {
    let liveWrapped: Array<{ appId: number; name?: string }> | null = null;
    try {
      const probe = await wrappedRunningApps();
      liveWrapped = probe?.ok
        ? (probe.app_ids ?? []).map((id) => ({
            appId: id,
            name: status?.managed_apps?.[String(id)]?.name,
          }))
        : null;
    } catch (e) {
      diag(`running-wrapper probe failed: ${String(e)}`);
      liveWrapped = null;
    }
    return {
      liveEffect: status?.live_effect ?? null,
      runningApp: runningApp?.name ?? null,
      runningWrapper:
        runningWrapper.state === "read"
          ? runningWrapper.path
          : runningWrapper.state === "unreadable"
            ? null
            : "",
      managedNames: Object.values(status?.managed_apps ?? {}).map((m) => m.name),
      liveWrapped,
    };
  };

  /** Run one planned step. A step that cannot be verified reports failure. */
  const runModeStep = async (
    step: Step,
    rel: string
  ): Promise<{ ok: boolean; detail: string }> => {
    if (step.kind === "clearAppScope") {
      const cleared = await clearAppScope(rel);
      return {
        ok: cleared,
        detail: cleared
          ? "Saved filters cleared."
          : "Some saved per-game wrappers could not be read or cleared — see the plugin log.",
      };
    }
    if (step.kind === "setGlobal") {
      if (step.enabled) {
        // Clearing the saved wrappers cannot stop a game that is already
        // running under one, and that game would be filtered twice. Re-probe
        // rather than trust the earlier reading.
        const again = await gatherModeFacts();
        if (again.liveWrapped === null) {
          return {
            ok: false,
            detail:
              "Could not re-check running games after cleanup; system-wide was not enabled.",
          };
        }
        if (again.liveWrapped.length) {
          return {
            ok: false,
            detail: `${describeApps(again.liveWrapped)} is already filtering until it exits. System-wide was not enabled.`,
          };
        }
      }
      const res = await setGlobalEnabled(step.enabled);
      return { ok: res.ok, detail: res.detail };
    }
    if (step.kind === "wrapForeground") {
      if (!runningApp) {
        return { ok: false, detail: "No game is running." };
      }
      const ok = await applyWrapper(
        runningApp.appId,
        runningApp.name,
        true,
        rel,
        status?.managed_apps?.[String(runningApp.appId)]
      );
      return {
        ok,
        detail: ok
          ? `Saved for ${runningApp.name}. It applies the next time that game starts.`
          : `Couldn't save launch options for ${runningApp.name} — nothing changed. See the plugin log.`,
      };
    }
    return { ok: false, detail: "Unknown step." };
  };

  const handleModeChange = async (mode: FilterMode) => {
    // Decky's dropdown can deliver repeated activation events before React has
    // rendered `busy=true`; guard synchronously so a fast double-press cannot
    // interleave enable/disable writes to Gamescope's property.
    if (modeBusyRef.current || busy || !status) return;
    modeBusyRef.current = true;
    setBusy(true);
    const rel = shaderPathFor(status);
    try {
      // Decide, then do. The decision (including every refusal) belongs to
      // src/mode.ts, which both languages used to duplicate.
      const facts = await gatherModeFacts();
      const change = planModeChange(mode, facts);
      diag(
        `mode change -> ${mode} (preset ${status.preset_id}, shader ${rel || "none"})`
      );
      if (change.kind === "refuse") {
        diag(`mode change refused: ${change.detail}`);
        toast(change.detail);
        return;
      }
      let detail = "";
      for (const step of change.steps) {
        const res = await runModeStep(step, rel);
        detail = res.detail;
        if (!res.ok) {
          diag(`mode change stopped at ${step.kind}: ${res.detail}`);
          toast(res.detail);
          return;
        }
      }
      if (mode === "off") {
        // A game already running under its own wrapper keeps filtering until
        // it exits, and no launch option can change that. Say so.
        if (facts.liveWrapped === null) {
          detail +=
            " Could not check whether a game is still running under its own filter.";
        } else if (facts.liveWrapped.length) {
          detail += ` ${describeApps(facts.liveWrapped)} is still running under its saved filter and keeps filtering until it exits.`;
        }
      }
      toast(detail);
    } catch (e) {
      toastError("Mode change", e);
    } finally {
      // Both refreshes are best-effort, and both must be attempted. Calling
      // them bare meant a rejected launch-option read skipped the guard reset
      // and left modeBusyRef true, so every later press silently did nothing.
      try {
        await refresh();
      } catch (e) {
        toastError("Post-change status refresh", e);
      }
      try {
        await refreshRunningWrapper(runningApp);
      } catch (e) {
        console.warn("DeckyCRT: post-change wrapper refresh failed", e);
      }
      modeBusyRef.current = false;
      setBusy(false);
    }
  };

  const handlePreset = async (presetId: string) => {
    if (modeBusyRef.current || busy) return;
    modeBusyRef.current = true;
    setBusy(true);
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
      diag(`preset ${presetId}: re-pointed ${ok}/${tracked.length} saved wrapper(s)`);
      if (ok !== tracked.length) {
        toast(
          `Updated the saved wrapper for ${ok} of ${tracked.length} game(s) — see the plugin log.`
        );
      } else if (ok > 0) {
        toast(`Saved wrapper re-pointed for ${ok} game(s).`);
      }
    } catch (e) {
      toastError("Preset switch", e);
    } finally {
      modeBusyRef.current = false;
      setBusy(false);
    }
  };

  const handleRemoveWrappers = async () => {
    if (modeBusyRef.current || busy) return;
    modeBusyRef.current = true;
    setBusy(true);
    try {
      const ok = await clearAppScope(shaderPathFor(status ?? (await getStatus())));
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
      modeBusyRef.current = false;
      setBusy(false);
    }
  };

  const handleSlider = (presetId: string, key: string, value: number) => {
    // Do not queue a delayed shader reapply while another mode transition is
    // in progress; it could resurrect the filter after the user selects Off.
    if (busy || modeBusyRef.current) return;
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

  useEffect(() => () => {
    for (const timer of Object.values(debounceTimers.current)) clearTimeout(timer);
    debounceTimers.current = {};
  }, []);

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

  /**
   * The portability instrument: what this plugin can see on this machine.
   *
   * A user on a setup nobody has tested can paste this instead of describing
   * it. Every capability the plugin depends on is in the block, so a missing
   * one names itself.
   */
  const handleDiagnostics = async () => {
    try {
      const res = await getDiagnostics();
      const rows = res?.rows ?? [];
      setDiagRows(rows);
      const text = `DeckyCRT diagnostics\n${rows
        .map((r) => `${r.label}: ${r.value}`)
        .join("\n")}`;
      try {
        await navigator.clipboard?.writeText(text);
        toast("Diagnostics copied — paste them where you're reporting.");
      } catch (e) {
        diag(`clipboard unavailable: ${String(e)}`);
        toast("Diagnostics are shown below — screenshot them.");
      }
    } catch (e) {
      toastError("Diagnostics", e);
    }
  };

  // ----------------------------------------------------------------- effects

  useEffect(() => {
    diag(`panel build ${PLUGIN_BUILD} mounted`);
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

  // Once, after the first status arrives: rescue any game left unlaunchable by
  // a gamescope crash under our wrapper.
  useEffect(() => {
    if (!status || recoveryRan) return;
    setRecoveryRan(true);
    (async () => {
      if (await recoverFromWrapperCrashes(status)) await refresh();
    })();
  }, [status, recoveryRan]);

  if (!status) {
    return (
      <PanelSection title="DeckyCRT">
        <PanelSectionRow>
          <div>Loading…</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  // ------------------------------------------------------------ derived view
  const managed = status.managed_apps ?? {};
  const managedEntries = Object.entries(managed);
  const managedCount = managedEntries.length;
  // One owner for the reading. `mode.ts` decides what the state is, including
  // when the honest answer is "unknown" rather than a guess at "off".
  const reading = readMode({
    liveEffect: status.live_effect,
    runningApp: runningApp?.name ?? null,
    runningWrapper:
      runningWrapper.state === "read"
        ? runningWrapper.path
        : runningWrapper.state === "unreadable"
          ? null
          : "",
    managedNames: managedEntries.map(([, info]) => info.name),
    liveWrapped: [],
  });
  const filterMode = reading.mode;
  const currentPreset = status.presets.find((p) => p.id === status.preset_id);
  const currentParams =
    currentPreset && status.params[currentPreset.id]
      ? status.params[currentPreset.id]
      : {};
  const presetOptions = status.presets.map((p) => ({
    data: p.id,
    label: p.name + (p.heavy ? " (heavy)" : ""),
  }));
  const modeOptions = [
    { data: "off", label: "Off" },
    {
      data: "app",
      label: runningApp ? `Active app: ${runningApp.name}` : "Active app",
    },
    { data: "system", label: "System-wide" },
  ];
  // An unknown reading gets its own entry rather than masquerading as "Off".
  // Selecting it re-reads; it is not a mode.
  const selectorOptions =
    reading.mode === "unknown"
      ? [...modeOptions, { data: "unknown", label: "Unknown — can't read Gamescope" }]
      : modeOptions;
  const managedNames = managedEntries.map(([, info]) => info.name).join(", ");
  const modeDescription =
    reading.mode === "unknown"
      ? `${reading.why} Changes that would add a filter are refused; Off still clears everything.`
      : reading.mode === "system"
        ? runningApp
          ? `Filtering the whole screen right now, including ${runningApp.name}.`
          : "Filtering the whole screen right now, including the Steam UI."
        : reading.mode === "app"
          ? runningWrapper.state === "read" && runningApp
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
          rgOptions={selectorOptions}
          selectedOption={
            selectorOptions.find((o) => o.data === filterMode) ??
            selectorOptions[0]
          }
          disabled={busy || !status.reshade_supported}
          onChange={(opt: { data: string }) => {
            // "unknown" is a reading, not a mode: selecting it re-reads the
            // state instead of pretending to change it.
            if (opt.data === "unknown") {
              void refresh();
              return;
            }
            handleModeChange(opt.data as FilterMode);
          }}
        />
        <DropdownItem
          label="Preset"
          rgOptions={presetOptions}
          selectedOption={
            presetOptions.find((o) => o.data === status.preset_id) ??
            presetOptions[0]
          }
          disabled={busy}
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
                  disabled={busy}
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
              options. A game that is already running keeps its filter until it
              restarts.
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
            shaders may not compile on your Gamescope build, and a community
            shader under the per-game wrapper is the least tested combination
            here. New presets appear in the list above after downloading.
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

      <PanelSection title="This setup">
        {!status.crash_guard_available && (
          <PanelSectionRow>
            <div style={{ fontSize: "0.8em", opacity: 0.75 }}>
              Crash guard unavailable: coredumpctl is not installed, so a game
              left unlaunchable by a Gamescope crash cannot be found
              automatically here. Everything else works.
            </div>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <div style={{ fontSize: "0.8em", opacity: 0.7 }}>
            What DeckyCRT can detect on this device
            {status.effect_access === "xprop"
              ? " (reaching Gamescope through the xprop fallback)"
              : status.effect_access === "none"
                ? " (nothing here can reach Gamescope's effect property)"
                : ""}
            . If something doesn't work, send this block.
          </div>
        </PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={handleDiagnostics}>
          {diagRows ? "Copy diagnostics again" : "Show and copy diagnostics"}
        </ButtonItem>
        {diagRows && (
          <PanelSectionRow>
            <div
              style={{
                fontFamily: "monospace",
                fontSize: "0.72em",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                opacity: 0.9,
              }}
            >
              {diagRows.map((r) => `${r.label}: ${r.value}`).join("\n")}
            </div>
          </PanelSectionRow>
        )}
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
