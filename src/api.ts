import { callable } from "@decky/api";

export interface PresetParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  relpath: string;
  heavy: boolean;
  params: PresetParam[];
}

export interface CommunityPack {
  id: string;
  name: string;
  description: string;
  installed: boolean;
}

export interface ManagedApp {
  name: string;
  relpath: string;
  /** True when we had to synthesize %command% for this game's options. */
  added_command?: boolean;
}

export interface StatusInfo {
  reshade_supported: boolean;
  xprop_available: boolean;
  displays: string[];
  shaders_installed: boolean;
  heavy_installed: boolean;
  global_enabled: boolean;
  preset_id: string;
  params: Record<string, Record<string, number>>;
  presets: Preset[];
  community_packs: CommunityPack[];
  /**
   * Games whose launch options carry a DeckyCRT wrapper, keyed by app id.
   * Persisted so Off / System-wide can clean up wrappers for games that are
   * not running — the wrapper lives in Steam's saved options, not in memory.
   */
  managed_apps: Record<string, ManagedApp>;
}

export interface ActionResult {
  ok: boolean;
  detail: string;
}

export interface HeavyResult {
  ok: boolean;
  relpath?: string;
  detail?: string;
}

export const getStatus = callable<[], StatusInfo>("get_status");
export const installShaders = callable<[], boolean>("install_shaders");
export const downloadHeavy = callable<[], HeavyResult>("download_heavy");
export const setPreset =
  callable<[preset_id: string], ActionResult>("set_preset");
export const setParam =
  callable<[preset_id: string, key: string, value: number, reapply: boolean], ActionResult>("set_param");
export const setGlobalEnabled =
  callable<[enabled: boolean], ActionResult>("set_global_enabled");
export const downloadPack =
  callable<[pack_id: string], ActionResult>("download_pack");
export const removePack =
  callable<[pack_id: string], ActionResult>("remove_pack");

/**
 * Remember (or forget) a game whose launch options carry our wrapper.
 *
 * The registry is what lets a later Off / System-wide switch clean up a game
 * that has since exited: the wrapper outlives the process.
 */
export const setManagedApp = callable<
  [
    app_id: number,
    name: string,
    relpath: string,
    enabled: boolean,
    added_command: boolean,
  ],
  ActionResult
>("set_managed_app");

export const clearManagedApps =
  callable<[], ActionResult>("clear_managed_apps");
