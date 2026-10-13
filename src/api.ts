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
