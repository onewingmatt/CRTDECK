/**
 * The Steam-side seams DeckyCRT uses, isolated in one place.
 *
 * Every one of these APIs is per-build: some are missing, and some exist as
 * functions but reject with "Unknown method". So each is feature-detected
 * before use and every call is guarded — an uncaught TypeError inside a React
 * effect takes the whole Decky panel down, which is exactly how this plugin
 * crashed before.
 *
 * Reading launch options is the part that has to be right: the value read back
 * is what the wrapper is written on top of, so a read that silently reports ""
 * for a game that has real options would erase them.
 *
 * On this Steam build (Bazzite/BC-250, 2026-10) the working read seam is
 * `SteamClient.Apps.RegisterForAppDetails(appId, cb)` — the same one the
 * installed decky-lsfg-vk plugin uses — while `SteamClient.Apps.GetAppDetails`
 * does not exist and `RegisterForAppLifetimeNotifications` rejects. The
 * `appDetailsStore` path is kept as a fallback.
 *
 * Diagnostics are `console.log("DeckyCRT: ...")` on purpose: they land in
 * Steam's CEF console (`~/.steam/steam/logs/cef_log.txt`), which is the only
 * place a frontend failure is visible when a mode change "does nothing".
 */

import { sameOptions } from "./launchOptions";

export interface RunningApp {
  appId: number;
  name: string;
}

export function log(message: string): void {
  console.log("DeckyCRT:", message);
}

function apps(): any {
  return (globalThis as any).SteamClient?.Apps;
}

function routerRoot(): any {
  const g = globalThis as any;
  return g.DFL?.Router ?? g.DeckyFrontendLib?.Router;
}

function detailsStore(): any {
  return (globalThis as any).appDetailsStore;
}

/** The app Steam currently has in the foreground, or null. */
export function readRunningApp(): RunningApp | null {
  try {
    const app = routerRoot()?.MainRunningApp;
    const appId = Number(app?.appid);
    if (!Number.isFinite(appId) || appId <= 0) return null;
    return {
      appId: appId >>> 0,
      name: app?.display_name || app?.name || `App ${appId >>> 0}`,
    };
  } catch {
    return null;
  }
}

export interface Capabilities {
  canWatchApps: boolean;
  canReadLaunchOptions: boolean;
  canWriteLaunchOptions: boolean;
}

export function capabilities(): Capabilities {
  const a = apps();
  const r = routerRoot();
  return {
    // The Router exposes MainRunningApp; null means "nothing running", which
    // still means the seam is there.
    canWatchApps: r != null && "MainRunningApp" in r,
    canReadLaunchOptions:
      typeof a?.RegisterForAppDetails === "function" ||
      typeof detailsStore()?.GetAppDetails === "function",
    canWriteLaunchOptions: typeof a?.SetAppLaunchOptions === "function",
  };
}

/**
 * One-shot app details via RegisterForAppDetails. The registration is
 * unregistered on the first callback so the panel does not leak subscriptions.
 */
function readViaRegister(appId: number): Promise<any | null> {
  return new Promise((resolve) => {
    const register = apps()?.RegisterForAppDetails;
    if (typeof register !== "function") {
      resolve(null);
      return;
    }
    let settled = false;
    let registration: any = null;
    const finish = (details: any | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      try {
        registration?.unregister?.();
      } catch {
        /* already gone */
      }
      resolve(details);
    };
    const timer = globalThis.setTimeout(
      () => finish(null),
      2500
    ) as unknown as number;
    try {
      registration = register.call(apps(), appId, (details: any) => {
        finish(details ?? {});
        return false;
      });
    } catch (e) {
      log(`RegisterForAppDetails threw for ${appId}: ${String(e)}`);
      finish(null);
    }
  });
}

/** One-shot app details via the store path, for builds without the register API. */
async function readViaStore(appId: number): Promise<any | null> {
  const store = detailsStore();
  if (typeof store?.GetAppDetails !== "function") return null;
  try {
    if (typeof store.RequestAppDetails === "function") {
      await store.RequestAppDetails(appId);
    }
    return store.GetAppDetails(appId) ?? null;
  } catch (e) {
    log(`appDetailsStore read failed for ${appId}: ${String(e)}`);
    return null;
  }
}

async function readDetails(appId: number): Promise<any | null> {
  const viaRegister = await readViaRegister(appId);
  if (viaRegister) return viaRegister;
  return readViaStore(appId);
}

/**
 * The game's saved launch options.
 *
 * Returns null when the value could NOT be read — never "". Callers must not
 * write on a null, because the write would replace real options with ours.
 */
export async function readLaunchOptions(appId: number): Promise<string | null> {
  const details = await readDetails(appId);
  if (details && typeof details.strLaunchOptions === "string") {
    return details.strLaunchOptions;
  }
  return null;
}

export async function readAppName(appId: number): Promise<string> {
  const details = await readDetails(appId);
  const name = details?.strDisplayName;
  return typeof name === "string" && name ? name : `App ${appId}`;
}

/**
 * Write launch options and confirm Steam accepted them.
 *
 * Verification matters: a setter that returns without error still does not
 * prove the value stuck, and the panel derives its mode from the value it can
 * read back. Polls up to ~5s — Steam applies the change asynchronously.
 */
export async function writeLaunchOptions(
  appId: number,
  value: string
): Promise<boolean> {
  const a = apps();
  const setter = a?.SetAppLaunchOptions;
  if (typeof setter !== "function") {
    log(`SetAppLaunchOptions unavailable — cannot write options for ${appId}`);
    return false;
  }
  try {
    await Promise.resolve(setter.call(a, appId, value));
  } catch (e) {
    log(`SetAppLaunchOptions threw for ${appId}: ${String(e)}`);
    return false;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const current = await readLaunchOptions(appId);
    if (current !== null && sameOptions(current, value)) {
      log(`launch options for ${appId} now ${JSON.stringify(current)}`);
      return true;
    }
    await new Promise((r) => globalThis.setTimeout(r, 250));
  }
  const last = await readLaunchOptions(appId);
  log(
    `Steam did not confirm launch options for ${appId}: wanted ` +
      `${JSON.stringify(value)}, read ${JSON.stringify(last)}`
  );
  return false;
}
