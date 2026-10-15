var DefaultContext = {
  color: undefined,
  size: undefined,
  className: undefined,
  style: undefined,
  attr: undefined
};
var IconContext = SP_REACT.createContext && /*#__PURE__*/SP_REACT.createContext(DefaultContext);

var _excluded = ["attr", "size", "title"];
function _objectWithoutProperties(e, t) { if (null == e) return {}; var o, r, i = _objectWithoutPropertiesLoose(e, t); if (Object.getOwnPropertySymbols) { var n = Object.getOwnPropertySymbols(e); for (r = 0; r < n.length; r++) o = n[r], -1 === t.indexOf(o) && {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]); } return i; }
function _objectWithoutPropertiesLoose(r, e) { if (null == r) return {}; var t = {}; for (var n in r) if ({}.hasOwnProperty.call(r, n)) { if (-1 !== e.indexOf(n)) continue; t[n] = r[n]; } return t; }
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), true).forEach(function (r) { _defineProperty(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
function _defineProperty(e, r, t) { return (r = _toPropertyKey(r)) in e ? Object.defineProperty(e, r, { value: t, enumerable: true, configurable: true, writable: true }) : e[r] = t, e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r); if ("object" != typeof i) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function Tree2Element(tree) {
  return tree && tree.map((node, i) => /*#__PURE__*/SP_REACT.createElement(node.tag, _objectSpread({
    key: i
  }, node.attr), Tree2Element(node.child)));
}
function GenIcon(data) {
  return props => /*#__PURE__*/SP_REACT.createElement(IconBase, _extends({
    attr: _objectSpread({}, data.attr)
  }, props), Tree2Element(data.child));
}
function IconBase(props) {
  var elem = conf => {
    var attr = props.attr,
      size = props.size,
      title = props.title,
      svgProps = _objectWithoutProperties(props, _excluded);
    var computedSize = size || conf.size || "1em";
    var className;
    if (conf.className) className = conf.className;
    if (props.className) className = (className ? className + " " : "") + props.className;
    return /*#__PURE__*/SP_REACT.createElement("svg", _extends({
      stroke: "currentColor",
      fill: "currentColor",
      strokeWidth: "0"
    }, conf.attr, attr, svgProps, {
      className: className,
      style: _objectSpread(_objectSpread({
        color: props.color || conf.color
      }, conf.style), props.style),
      height: computedSize,
      width: computedSize,
      xmlns: "http://www.w3.org/2000/svg"
    }), title && /*#__PURE__*/SP_REACT.createElement("title", null, title), props.children);
  };
  return IconContext !== undefined ? /*#__PURE__*/SP_REACT.createElement(IconContext.Consumer, null, conf => elem(conf)) : elem(DefaultContext);
}

// THIS FILE IS AUTO GENERATED
function FaTv (props) {
  return GenIcon({"attr":{"viewBox":"0 0 640 512"},"child":[{"tag":"path","attr":{"d":"M592 0H48A48 48 0 0 0 0 48v320a48 48 0 0 0 48 48h240v32H112a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h416a16 16 0 0 0 16-16v-32a16 16 0 0 0-16-16H352v-32h240a48 48 0 0 0 48-48V48a48 48 0 0 0-48-48zm-16 352H64V64h512z"},"child":[]}]})(props);
}

const manifest = {"name":"DeckyCRT"};
const API_VERSION = 2;
const internalAPIConnection = window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit;
if (!internalAPIConnection) {
    throw new Error('[@decky/api]: Failed to connect to the loader as as the loader API was not initialized. This is likely a bug in Decky Loader.');
}
let api;
try {
    api = internalAPIConnection.connect(API_VERSION, manifest.name);
}
catch {
    api = internalAPIConnection.connect(1, manifest.name);
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version 1. Some features may not work.`);
}
if (api._version != API_VERSION) {
    console.warn(`[@decky/api] Requested API version ${API_VERSION} but the running loader only supports version ${api._version}. Some features may not work.`);
}
const callable = api.callable;
const toaster = api.toaster;
const definePlugin = (fn) => {
    return (...args) => {
        return fn(...args);
    };
};

const getStatus = callable("get_status");
const installShaders = callable("install_shaders");
const downloadHeavy = callable("download_heavy");
const setPreset = callable("set_preset");
const setParam = callable("set_param");
const setGlobalEnabled = callable("set_global_enabled");
const downloadPack = callable("download_pack");
const removePack = callable("remove_pack");
/**
 * Record a line in the plugin's own log file. The panel's console output only
 * reaches Steam's CEF console, which is not always written to disk; this is the
 * channel that survives.
 */
const note = callable("note");
/**
 * Games whose launch died with gamescope while running under our per-game
 * wrapper. Those games cannot start until the wrapper is stripped.
 *
 * `ok: false` means the scan itself could not run — which is NOT the same as
 * "no crashes", and is worth telling the user about: a game may be sitting
 * there unlaunchable while every check reports all clear.
 */
const checkWrapperCrashes = callable("check_wrapper_crashes");
/**
 * App ids running right now under our nested gamescope. A saved wrapper only
 * applies at the next launch; this says whether it is filtering the process
 * that is on screen, which is what makes system-wide double-apply.
 */
const wrappedRunningApps = callable("wrapped_running_apps");
/**
 * Remember (or forget) a game whose launch options carry our wrapper.
 *
 * The registry is what lets a later Off / System-wide switch clean up a game
 * that has since exited: the wrapper outlives the process.
 */
const setManagedApp = callable("set_managed_app");
const clearManagedApps = callable("clear_managed_apps");

/**
 * Launch-option surgery for DeckyCRT's active-app mode.
 *
 * A Gamescope/ReShade wrapper has to live inside the game's Steam launch
 * options as tokens:
 *
 *   gamescope --reshade-effect deckycrt/aperture-grille.fx -- %command%
 *
 * Two details make this fiddly, and both have already bitten this plugin:
 *
 * - `%command%` is not necessarily the first token. Real options often begin
 *   with environment assignments ("PROTON_ENABLE_WAYLAND=1 %command%") that
 *   Steam applies to the process it launches. Prepending the wrapper pushes
 *   those behind gamescope's `--`, so the game loses them. The wrapper is
 *   inserted immediately BEFORE `%command%` instead, leaving leading
 *   assignments untouched.
 * - Removal must strip exactly our tokens, so the user's original string comes
 *   back byte-for-byte (modulo whitespace normalization).
 *
 * Pure string handling with no Steam API, so it is unit-testable on its own:
 * scripts/test-launch-options.ts.
 */
const COMMAND_TOKEN = "%command%";
// Our shader paths are always deckycrt/…, deckycrt-heavy/… or
// deckycrt-community/…, so the directory name is enough to recognize our own
// wrapper and never someone else's.
function isDeckyCrtShaderPath(value) {
    return value.includes("deckycrt");
}
const unquote = (raw) => {
    let value = "";
    let quote = null;
    for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === "\\" && quote !== "'" && i + 1 < raw.length) {
            value += raw[++i];
        }
        else if (quote) {
            if (c === quote)
                quote = null;
            else
                value += c;
        }
        else if (c === "'" || c === '"') {
            quote = c;
        }
        else {
            value += c;
        }
    }
    return value;
};
function tokenize(options) {
    const tokens = [];
    let start = -1;
    let quote = null;
    let escaped = false;
    const push = (end) => {
        if (start < 0)
            return;
        const raw = options.slice(start, end);
        tokens.push({ raw, value: unquote(raw) });
        start = -1;
    };
    for (let i = 0; i < options.length; i++) {
        const c = options[i];
        if (start < 0) {
            if (/\s/.test(c))
                continue;
            start = i;
        }
        if (escaped)
            escaped = false;
        else if (c === "\\" && quote !== "'")
            escaped = true;
        else if (quote) {
            if (c === quote)
                quote = null;
        }
        else if (c === "'" || c === '"')
            quote = c;
        else if (/\s/.test(c))
            push(i);
    }
    push(options.length);
    return tokens;
}
function serialize(tokens) {
    return tokens.map((t) => t.raw).join(" ");
}
/** Compare two launch-option strings ignoring whitespace differences. */
function sameOptions(a, b) {
    if (a === null || b === null)
        return a === b;
    return serialize(tokenize(a)) === serialize(tokenize(b));
}
const isCommandToken = (token) => token.value.toLowerCase() === COMMAND_TOKEN;
const isMalformedCommandToken = (token) => {
    const v = token.value.toLowerCase();
    return v === "%command" || v === "command%";
};
const isAssignment = (token) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value);
const commandIndex = (tokens) => tokens.findIndex(isCommandToken);
/** Steam accepts `%command`, `command%` and `%command%`; normalize the typo forms. */
function normalizeCommandTokens(tokens) {
    for (const token of tokens) {
        if (isCommandToken(token) || isMalformedCommandToken(token)) {
            token.raw = COMMAND_TOKEN;
            token.value = COMMAND_TOKEN;
        }
    }
}
/** Locate our own wrapper: gamescope --reshade-effect deckycrt… -- */
function findWrapper(tokens) {
    for (let i = 0; i + 3 < tokens.length; i++) {
        if (tokens[i].value === "gamescope" &&
            tokens[i + 1].value === "--reshade-effect" &&
            isDeckyCrtShaderPath(tokens[i + 2].value) &&
            tokens[i + 3].value === "--") {
            return { start: i, path: tokens[i + 2].value };
        }
    }
    return null;
}
/** The shader path our wrapper currently points at, or null when absent. */
function wrapperPath(options) {
    return findWrapper(tokenize(options))?.path ?? null;
}
/**
 * A gamescope invocation in the prefix that is NOT ours. Stacking a second
 * gamescope would double-composite, so callers must refuse instead.
 */
function hasForeignGamescopeWrapper(tokens) {
    const command = commandIndex(tokens);
    const end = command >= 0 ? command : tokens.length;
    const mine = findWrapper(tokens);
    for (let i = 0; i < end; i++) {
        if (tokens[i].value === "gamescope" && i !== mine?.start)
            return true;
    }
    return false;
}
/** Insert or re-point our wrapper. Idempotent for the same path. */
function installWrapper(options, shaderPath) {
    const tokens = tokenize(options);
    normalizeCommandTokens(tokens);
    const existing = findWrapper(tokens);
    if (existing) {
        if (existing.path === shaderPath) {
            return { options: serialize(tokens), changed: false };
        }
        tokens[existing.start + 2] = { raw: shaderPath, value: shaderPath };
        return { options: serialize(tokens), changed: true };
    }
    if (hasForeignGamescopeWrapper(tokens)) {
        return { options: serialize(tokens), changed: false, blocked: "foreign-gamescope" };
    }
    const wrapper = [
        { raw: "gamescope", value: "gamescope" },
        { raw: "--reshade-effect", value: "--reshade-effect" },
        { raw: shaderPath, value: shaderPath },
        { raw: "--", value: "--" },
    ];
    const command = commandIndex(tokens);
    if (command >= 0) {
        tokens.splice(command, 0, ...wrapper);
        return { options: serialize(tokens), changed: true, addedCommand: false };
    }
    // No placeholder: keep leading env assignments first, then wrapper, then add
    // %command% so the game exe lands after gamescope's `--`.
    let insertion = 0;
    while (insertion < tokens.length && isAssignment(tokens[insertion])) {
        insertion++;
    }
    tokens.splice(insertion, 0, ...wrapper, {
        raw: COMMAND_TOKEN,
        value: COMMAND_TOKEN,
    });
    return { options: serialize(tokens), changed: true, addedCommand: true };
}
/**
 * Strip our wrapper, leaving everything else as it was.
 *
 * `dropCommand` must be the `addedCommand` flag recorded when the wrapper was
 * installed, so a synthesized `%command%` is removed with it.
 */
function removeWrapper(options, dropCommand = false) {
    const tokens = tokenize(options);
    normalizeCommandTokens(tokens);
    const found = findWrapper(tokens);
    if (!found)
        return { options: serialize(tokens), changed: false };
    tokens.splice(found.start, 4);
    if (dropCommand) {
        const command = commandIndex(tokens);
        if (command >= 0)
            tokens.splice(command, 1);
    }
    return { options: serialize(tokens), changed: true };
}

/**
 * Which filter is live, and what changing it costs.
 *
 * The truth about the filter is genuinely two-sided: only Gamescope knows
 * whether a filter is live (the backend reads it over xprop), and only Steam
 * knows which games hold a saved wrapper (they live in launch options, which
 * Python cannot see). So this module owns the *policy* — one reading, one
 * refusal rule, one order of operations — and the panel supplies the facts and
 * runs the steps.
 *
 * It exists because that policy was previously written twice, once in the
 * panel and once in the backend, and each side re-checked the other's answer
 * because neither could see the whole picture.
 *
 * No React, no bridge: everything here is decisions, so `scripts/test-mode.ts`
 * can drive it with plain node.
 */
const base = (path) => path.split("/").pop() || path;
const names = (apps) => apps.map((a) => a.name || `App ${a.appId}`).join(", ");
/** How the panel refers to a set of running wrapped games, in one voice. */
function describeApps(apps) {
    return names(apps);
}
/**
 * Read the mode from the facts.
 *
 * `unknown` whenever the answer depends on something that could not be read.
 * Collapsing that to "off" is how two filters end up stacked on one picture.
 */
function readMode(f) {
    if (f.liveEffect === null) {
        return {
            mode: "unknown",
            why: "Couldn't read Gamescope's live filter state.",
        };
    }
    if (f.liveEffect !== "") {
        return {
            mode: "system",
            why: `Gamescope is filtering the whole screen with ${base(f.liveEffect)}.`,
        };
    }
    if (f.runningApp !== null && f.runningWrapper === null) {
        return {
            mode: "unknown",
            why: `Couldn't read ${f.runningApp}'s saved launch options.`,
        };
    }
    if (f.runningWrapper || f.managedNames.length) {
        return {
            mode: "app",
            why: f.runningWrapper && f.runningApp
                ? `Saved in ${f.runningApp}'s launch options — applies at that game's next launch.`
                : `Saved for ${f.managedNames.join(", ")} — applies at each game's next launch.`,
        };
    }
    return { mode: "off", why: "No filter is live." };
}
/**
 * What to do to reach `target`, or why we will not.
 *
 * The two filters must not stack: a wrapper only takes effect at a game's next
 * launch, so a game already running under one keeps filtering until it exits,
 * and system-wide would filter the same pixels a second time.
 */
function planModeChange(target, f) {
    const unreadable = () => ({
        kind: "refuse",
        detail: "Couldn't read Gamescope's live filter state, so no mode change was made.",
    });
    if (target === "off") {
        // Off is the escape hatch and is never refused: it strips the saved
        // wrappers even when the live property cannot be read, and the panel
        // reports whatever the global layer turned out to be.
        return {
            kind: "apply",
            steps: [{ kind: "clearAppScope" }, { kind: "setGlobal", enabled: false }],
        };
    }
    if (f.liveEffect === null)
        return unreadable();
    if (f.runningApp !== null && f.runningWrapper === null) {
        return {
            kind: "refuse",
            detail: `Couldn't read ${f.runningApp}'s saved launch options, so it may already hold a filter. Close that game and try again.`,
        };
    }
    if (target === "system") {
        // Fail closed: if the probe cannot answer, we do not know whether a
        // wrapper is live, and guessing "none" is exactly what stacks the passes.
        if (f.liveWrapped === null) {
            return {
                kind: "refuse",
                detail: "Couldn't tell whether a game is already running its own CRT filter, so system-wide was not enabled. Close any running game and try again.",
            };
        }
        if (f.liveWrapped.length) {
            return {
                kind: "refuse",
                detail: `${names(f.liveWrapped)} is already running under its own CRT filter, and both would filter the same picture (double blur). Close that game first, or set the filter to Off.`,
            };
        }
        return {
            kind: "apply",
            steps: [{ kind: "clearAppScope" }, { kind: "setGlobal", enabled: true }],
        };
    }
    if (f.runningApp === null) {
        return {
            kind: "refuse",
            detail: "Start a game first — active-app mode saves the filter in that game's launch options.",
        };
    }
    // The wrapper cannot filter the copy that is already running, so the
    // session-wide filter has to come off first or the picture stays filtered
    // until that game exits.
    return {
        kind: "apply",
        steps: [
            { kind: "setGlobal", enabled: false },
            { kind: "wrapForeground" },
        ],
    };
}

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
function log(message) {
    console.log("DeckyCRT:", message);
}
function apps() {
    return globalThis.SteamClient?.Apps;
}
function routerRoot() {
    const g = globalThis;
    return g.DFL?.Router ?? g.DeckyFrontendLib?.Router;
}
function detailsStore() {
    return globalThis.appDetailsStore;
}
/** The app Steam currently has in the foreground, or null. */
function readRunningApp() {
    try {
        const app = routerRoot()?.MainRunningApp;
        const appId = Number(app?.appid);
        if (!Number.isFinite(appId) || appId <= 0)
            return null;
        return {
            appId: appId >>> 0,
            name: app?.display_name || app?.name || `App ${appId >>> 0}`,
        };
    }
    catch {
        return null;
    }
}
function capabilities() {
    const a = apps();
    const r = routerRoot();
    return {
        // The Router exposes MainRunningApp; null means "nothing running", which
        // still means the seam is there.
        canWatchApps: r != null && "MainRunningApp" in r,
        canReadLaunchOptions: typeof a?.RegisterForAppDetails === "function" ||
            typeof detailsStore()?.GetAppDetails === "function",
        canWriteLaunchOptions: typeof a?.SetAppLaunchOptions === "function",
    };
}
/**
 * One-shot app details via RegisterForAppDetails. The registration is
 * unregistered on the first callback so the panel does not leak subscriptions.
 */
function readViaRegister(appId) {
    return new Promise((resolve) => {
        const register = apps()?.RegisterForAppDetails;
        if (typeof register !== "function") {
            resolve(null);
            return;
        }
        let settled = false;
        let registration = null;
        const finish = (details) => {
            if (settled)
                return;
            settled = true;
            globalThis.clearTimeout(timer);
            try {
                registration?.unregister?.();
            }
            catch {
                /* already gone */
            }
            resolve(details);
        };
        const timer = globalThis.setTimeout(() => finish(null), 2500);
        try {
            registration = register.call(apps(), appId, (details) => {
                finish(details ?? {});
                return false;
            });
        }
        catch (e) {
            log(`RegisterForAppDetails threw for ${appId}: ${String(e)}`);
            finish(null);
        }
    });
}
/** One-shot app details via the store path, for builds without the register API. */
async function readViaStore(appId) {
    const store = detailsStore();
    if (typeof store?.GetAppDetails !== "function")
        return null;
    try {
        if (typeof store.RequestAppDetails === "function") {
            await store.RequestAppDetails(appId);
        }
        return store.GetAppDetails(appId) ?? null;
    }
    catch (e) {
        log(`appDetailsStore read failed for ${appId}: ${String(e)}`);
        return null;
    }
}
async function readDetails(appId) {
    const viaRegister = await readViaRegister(appId);
    if (viaRegister)
        return viaRegister;
    return readViaStore(appId);
}
/**
 * The game's saved launch options.
 *
 * Returns null when the value could NOT be read — never "". Callers must not
 * write on a null, because the write would replace real options with ours.
 */
async function readLaunchOptions(appId) {
    const details = await readDetails(appId);
    if (details && typeof details.strLaunchOptions === "string") {
        return details.strLaunchOptions;
    }
    return null;
}
/**
 * Write launch options and confirm Steam accepted them.
 *
 * Verification matters: a setter that returns without error still does not
 * prove the value stuck, and the panel derives its mode from the value it can
 * read back. Polls up to ~5s — Steam applies the change asynchronously.
 */
async function writeLaunchOptions(appId, value) {
    const a = apps();
    const setter = a?.SetAppLaunchOptions;
    if (typeof setter !== "function") {
        log(`SetAppLaunchOptions unavailable — cannot write options for ${appId}`);
        return false;
    }
    try {
        await Promise.resolve(setter.call(a, appId, value));
    }
    catch (e) {
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
    log(`Steam did not confirm launch options for ${appId}: wanted ` +
        `${JSON.stringify(value)}, read ${JSON.stringify(last)}`);
    return false;
}

/**
 * Build identity for the panel.
 *
 * Decky serves a plugin's bundle from a fixed URL, so a panel that was already
 * loaded can keep running the previous build while the file on disk has moved
 * on — which makes "I deployed the fix" indistinguishable from "the fix is
 * live" from the outside. The panel reports this string to the plugin log on
 * mount, so the log answers which build actually ran.
 *
 * Bump it whenever a change needs to be confirmed on the device.
 */
const PLUGIN_BUILD = "0.4.4-mode";

function toast(body) {
    toaster.toast({ title: "DeckyCRT", body });
}
/**
 * A mode change that "does nothing" otherwise leaves no trace the user can
 * look at. Every decision goes to Steam's CEF console AND to the plugin's own
 * log file (through the backend), because the CEF console is not reliably
 * written to disk and a deployed fix that never ran is indistinguishable from
 * one that ran and failed.
 */
function diag(message) {
    log(message);
    void note(message).catch(() => undefined);
}
// A rejected backend call must never surface as a raw panel error — that is
// what the "an error occurred in DeckyCRT" banner actually is.
function toastError(what, e) {
    toast(`${what} failed — see the plugin log`);
    diag(`${what} failed: ${String(e)}`);
}
// The backend derives these ranges, but the panel must not trust any of it:
// a SliderField with a value outside [min, max] takes the whole panel down.
function paramIsUsable(p) {
    return (Number.isFinite(p.min) &&
        Number.isFinite(p.max) &&
        Number.isFinite(p.step) &&
        p.max > p.min &&
        p.step > 0 &&
        p.step <= p.max - p.min);
}
function sliderValue(p, v) {
    const base = typeof v === "number" && Number.isFinite(v) ? v : p.default;
    const clamped = Math.min(Math.max(base, p.min), p.max);
    return Number.isFinite(clamped) ? clamped : p.min;
}
function shaderPathFor(status, presetId) {
    const id = status.preset_id;
    return status.presets.find((p) => p.id === id)?.relpath ?? "";
}
function Content() {
    const [status, setStatus] = SP_REACT.useState(null);
    const [runningApp, setRunningApp] = SP_REACT.useState(null);
    const [caps, setCaps] = SP_REACT.useState(null);
    // The foreground game's saved wrapper. `unreadable` stays distinct from
    // `no-game`: collapsing them is how the panel guesses, and the guess is what
    // puts two filters on one picture.
    const [runningWrapper, setRunningWrapper] = SP_REACT.useState({ state: "no-game" });
    const [busy, setBusy] = SP_REACT.useState(false);
    const [recoveryRan, setRecoveryRan] = SP_REACT.useState(false);
    const debounceTimers = SP_REACT.useRef({});
    const refresh = async () => {
        try {
            const s = await getStatus();
            setStatus(s);
            return s;
        }
        catch (e) {
            toastError("Status refresh", e);
            return null;
        }
    };
    const refreshRunningWrapper = async (app) => {
        if (!app) {
            setRunningWrapper({ state: "no-game" });
            return;
        }
        const cur = await readLaunchOptions(app.appId);
        setRunningWrapper(cur === null
            ? { state: "unreadable" }
            : { state: "read", path: wrapperPath(cur) ?? "" });
        diag(`running app ${app.appId} (${app.name}) options ` +
            (cur === null ? "unreadable" : JSON.stringify(cur)));
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
    const applyWrapper = async (appId, name, enable, rel, prior) => {
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
            diag(`wrap ${appId} (${name}): ${JSON.stringify(cur)} -> ` +
                `${JSON.stringify(res.options)} ok=${ok}`);
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
        diag(`unwrap ${appId} (${name}): ${JSON.stringify(cur)} -> ` +
            `${JSON.stringify(res.options)} ok=${ok}`);
        if (ok)
            await setManagedApp(appId, name, rel, false, false);
        return ok;
    };
    /** Strip the per-game wrapper everywhere it is known to be. */
    const clearAppScope = async (rel) => {
        const managed = status?.managed_apps ?? {};
        const targets = [];
        if (runningApp)
            targets.push(runningApp);
        for (const [id, info] of Object.entries(managed)) {
            const appId = Number(id);
            if (!Number.isFinite(appId) || appId <= 0)
                continue;
            if (targets.some((t) => t.appId === appId))
                continue;
            targets.push({ appId, name: info.name });
        }
        let ok = true;
        for (const t of targets) {
            if (!(await applyWrapper(t.appId, t.name, false, rel, managed[String(t.appId)]))) {
                ok = false;
            }
        }
        if (ok)
            await clearManagedApps();
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
    const recoverFromWrapperCrashes = async (s) => {
        const managed = s.managed_apps ?? {};
        if (!Object.keys(managed).length)
            return false;
        let res;
        try {
            res = await checkWrapperCrashes();
        }
        catch (e) {
            toastError("Wrapper crash check", e);
            return false;
        }
        if (!res?.crashes?.length) {
            // A scan that could not run is not "no crashes". Staying silent here is
            // how a game sits unlaunchable while every check reports all clear.
            if (res && res.ok === false) {
                diag(`crash scan could not run: ${res.detail ?? "no detail"}`);
                toast("Couldn't check whether a saved CRT wrapper is stopping a game from launching — see the plugin log.");
            }
            return false;
        }
        const rel = shaderPathFor(s);
        const cleaned = [];
        const stuck = [];
        for (const crash of res.crashes) {
            const ok = await applyWrapper(crash.app_id, crash.name, false, rel, managed[String(crash.app_id)]);
            diag(`crash recovery: wrapper for ${crash.app_id} (${crash.name}, ` +
                `${crash.shader}) ${ok ? "removed" : "COULD NOT BE REMOVED"}`);
            if (ok && !cleaned.includes(crash.name))
                cleaned.push(crash.name);
            if (!ok && !stuck.includes(crash.name))
                stuck.push(crash.name);
        }
        if (cleaned.length) {
            toast(`Gamescope crashed starting ${cleaned.join(", ")} under a saved CRT wrapper — the wrapper was removed, so the game launches normally again.`);
        }
        if (stuck.length) {
            toast(`Couldn't remove the saved wrapper for ${stuck.join(", ")} — see the plugin log.`);
        }
        return cleaned.length > 0;
    };
    // Shared synchronous guard for every operation that mutates filter state.
    // React's busy state update is asynchronous and cannot serialize rapid events.
    const modeBusyRef = SP_REACT.useRef(false);
    /**
     * Everything the mode decision needs, gathered in one place.
     *
     * A `null` field means "could not be read", which is a different answer from
     * "nothing there". Keeping them apart is the whole point: the old code
     * guessed, and the guess is what stacks two filters on one picture.
     */
    const gatherModeFacts = async () => {
        let liveWrapped = null;
        try {
            const probe = await wrappedRunningApps();
            liveWrapped = probe?.ok
                ? (probe.app_ids ?? []).map((id) => ({
                    appId: id,
                    name: status?.managed_apps?.[String(id)]?.name,
                }))
                : null;
        }
        catch (e) {
            diag(`running-wrapper probe failed: ${String(e)}`);
            liveWrapped = null;
        }
        return {
            liveEffect: status?.live_effect ?? null,
            runningApp: runningApp?.name ?? null,
            runningWrapper: runningWrapper.state === "read"
                ? runningWrapper.path
                : runningWrapper.state === "unreadable"
                    ? null
                    : "",
            managedNames: Object.values(status?.managed_apps ?? {}).map((m) => m.name),
            liveWrapped,
        };
    };
    /** Run one planned step. A step that cannot be verified reports failure. */
    const runModeStep = async (step, rel) => {
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
                        detail: "Could not re-check running games after cleanup; system-wide was not enabled.",
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
            const ok = await applyWrapper(runningApp.appId, runningApp.name, true, rel, status?.managed_apps?.[String(runningApp.appId)]);
            return {
                ok,
                detail: ok
                    ? `Saved for ${runningApp.name}. It applies the next time that game starts.`
                    : `Couldn't save launch options for ${runningApp.name} — nothing changed. See the plugin log.`,
            };
        }
        return { ok: false, detail: "Unknown step." };
    };
    const handleModeChange = async (mode) => {
        // Decky's dropdown can deliver repeated activation events before React has
        // rendered `busy=true`; guard synchronously so a fast double-press cannot
        // interleave enable/disable writes to Gamescope's property.
        if (modeBusyRef.current || busy || !status)
            return;
        modeBusyRef.current = true;
        setBusy(true);
        const rel = shaderPathFor(status);
        try {
            // Decide, then do. The decision (including every refusal) belongs to
            // src/mode.ts, which both languages used to duplicate.
            const facts = await gatherModeFacts();
            const change = planModeChange(mode, facts);
            diag(`mode change -> ${mode} (preset ${status.preset_id}, shader ${rel || "none"})`);
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
                }
                else if (facts.liveWrapped.length) {
                    detail += ` ${describeApps(facts.liveWrapped)} is still running under its saved filter and keeps filtering until it exits.`;
                }
            }
            toast(detail);
        }
        catch (e) {
            toastError("Mode change", e);
        }
        finally {
            // Both refreshes are best-effort, and both must be attempted. Calling
            // them bare meant a rejected launch-option read skipped the guard reset
            // and left modeBusyRef true, so every later press silently did nothing.
            try {
                await refresh();
            }
            catch (e) {
                toastError("Post-change status refresh", e);
            }
            try {
                await refreshRunningWrapper(runningApp);
            }
            catch (e) {
                console.warn("DeckyCRT: post-change wrapper refresh failed", e);
            }
            modeBusyRef.current = false;
            setBusy(false);
        }
    };
    const handlePreset = async (presetId) => {
        if (modeBusyRef.current || busy)
            return;
        modeBusyRef.current = true;
        setBusy(true);
        try {
            const res = await setPreset(presetId);
            if (!res.ok) {
                toast(res.detail);
                return;
            }
            const fresh = await refresh();
            if (!fresh)
                return;
            // Saved wrappers point at a path; a preset change has to re-point them
            // or the game keeps launching the old shader.
            const tracked = Object.entries(fresh.managed_apps ?? {});
            if (!tracked.length)
                return;
            const rel = shaderPathFor(fresh);
            let ok = 0;
            for (const [id, info] of tracked) {
                const appId = Number(id);
                if (!Number.isFinite(appId) || appId <= 0)
                    continue;
                if (await applyWrapper(appId, info.name, true, rel, info))
                    ok++;
            }
            diag(`preset ${presetId}: re-pointed ${ok}/${tracked.length} saved wrapper(s)`);
            if (ok !== tracked.length) {
                toast(`Updated the saved wrapper for ${ok} of ${tracked.length} game(s) — see the plugin log.`);
            }
            else if (ok > 0) {
                toast(`Saved wrapper re-pointed for ${ok} game(s).`);
            }
        }
        catch (e) {
            toastError("Preset switch", e);
        }
        finally {
            modeBusyRef.current = false;
            setBusy(false);
        }
    };
    const handleRemoveWrappers = async () => {
        if (modeBusyRef.current || busy)
            return;
        modeBusyRef.current = true;
        setBusy(true);
        try {
            const ok = await clearAppScope(shaderPathFor(status ?? (await getStatus())));
            toast(ok
                ? "Per-game wrappers removed."
                : "Some wrappers could not be cleared — see the plugin log.");
            await refresh();
            await refreshRunningWrapper(runningApp);
        }
        catch (e) {
            toastError("Wrapper cleanup", e);
        }
        finally {
            modeBusyRef.current = false;
            setBusy(false);
        }
    };
    const handleSlider = (presetId, key, value) => {
        // Do not queue a delayed shader reapply while another mode transition is
        // in progress; it could resurrect the filter after the user selects Off.
        if (busy || modeBusyRef.current)
            return;
        setStatus((prev) => prev
            ? {
                ...prev,
                params: {
                    ...prev.params,
                    [presetId]: { ...prev.params[presetId], [key]: value },
                },
            }
            : prev);
        const timerKey = `${presetId}:${key}`;
        if (debounceTimers.current[timerKey])
            clearTimeout(debounceTimers.current[timerKey]);
        debounceTimers.current[timerKey] = setTimeout(async () => {
            try {
                const res = await setParam(presetId, key, value, true);
                if (!res.ok)
                    toast(res.detail);
            }
            catch (e) {
                toastError("Slider change", e);
            }
        }, 600);
    };
    SP_REACT.useEffect(() => () => {
        for (const timer of Object.values(debounceTimers.current))
            clearTimeout(timer);
        debounceTimers.current = {};
    }, []);
    const handleDownloadHeavy = async () => {
        setBusy(true);
        try {
            const res = await downloadHeavy();
            toast(res.ok ? `Installed: ${res.relpath}` : `Failed: ${res.detail}`);
            await refresh();
        }
        catch (e) {
            toastError("Heavy shader download", e);
        }
        finally {
            setBusy(false);
        }
    };
    const handleDownloadPack = async (packId) => {
        setBusy(true);
        try {
            const res = await downloadPack(packId);
            toast(res.detail);
            await refresh();
        }
        catch (e) {
            toastError("Pack download", e);
        }
        finally {
            setBusy(false);
        }
    };
    const handleRemovePack = async (packId) => {
        try {
            const res = await removePack(packId);
            toast(res.detail);
            await refresh();
        }
        catch (e) {
            toastError("Pack removal", e);
        }
    };
    // ----------------------------------------------------------------- effects
    SP_REACT.useEffect(() => {
        diag(`panel build ${PLUGIN_BUILD} mounted`);
        (async () => {
            try {
                let s = await getStatus();
                if (!s.shaders_installed) {
                    await installShaders();
                    s = await getStatus();
                }
                setStatus(s);
            }
            catch (e) {
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
            setRunningApp((current) => current?.appId === app?.appId && current?.name === app?.name
                ? current
                : app);
        };
        poll();
        const interval = globalThis.setInterval(poll, 1500);
        return () => globalThis.clearInterval(interval);
    }, []);
    // Re-read the wrapper state whenever the foreground app changes.
    SP_REACT.useEffect(() => {
        void refreshRunningWrapper(runningApp);
    }, [runningApp]);
    // Once, after the first status arrives: rescue any game left unlaunchable by
    // a gamescope crash under our wrapper.
    SP_REACT.useEffect(() => {
        if (!status || recoveryRan)
            return;
        setRecoveryRan(true);
        (async () => {
            if (await recoverFromWrapperCrashes(status))
                await refresh();
        })();
    }, [status, recoveryRan]);
    if (!status) {
        return (SP_JSX.jsx(DFL.PanelSection, { title: "DeckyCRT", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { children: "Loading\u2026" }) }) }));
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
        runningWrapper: runningWrapper.state === "read"
            ? runningWrapper.path
            : runningWrapper.state === "unreadable"
                ? null
                : "",
        managedNames: managedEntries.map(([, info]) => info.name)});
    const filterMode = reading.mode;
    const currentPreset = status.presets.find((p) => p.id === status.preset_id);
    const currentParams = currentPreset && status.params[currentPreset.id]
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
    const selectorOptions = reading.mode === "unknown"
        ? [...modeOptions, { data: "unknown", label: "Unknown — can't read Gamescope" }]
        : modeOptions;
    const managedNames = managedEntries.map(([, info]) => info.name).join(", ");
    const modeDescription = reading.mode === "unknown"
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
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "CRT filter", children: [!status.reshade_supported && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { children: "Gamescope ReShade support not detected. Shaders can't be applied on this system." }) })), SP_JSX.jsx(DFL.DropdownItem, { label: "Filter mode", description: modeDescription, rgOptions: selectorOptions, selectedOption: selectorOptions.find((o) => o.data === filterMode) ??
                            selectorOptions[0], disabled: busy || !status.reshade_supported, onChange: (opt) => {
                            // "unknown" is a reading, not a mode: selecting it re-reads the
                            // state instead of pretending to change it.
                            if (opt.data === "unknown") {
                                void refresh();
                                return;
                            }
                            handleModeChange(opt.data);
                        } }), SP_JSX.jsx(DFL.DropdownItem, { label: "Preset", rgOptions: presetOptions, selectedOption: presetOptions.find((o) => o.data === status.preset_id) ??
                            presetOptions[0], disabled: busy, onChange: (opt) => handlePreset(opt.data) }), currentPreset && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.85em", opacity: 0.8 }, children: currentPreset.description }) })), showHeavyDownload && (SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: handleDownloadHeavy, disabled: busy, children: busy ? "Downloading…" : "Download CRT-Royale (heavy)" })), currentPreset?.params
                        ? currentPreset.params
                            .filter(paramIsUsable)
                            .slice(0, 12)
                            .map((param) => (SP_JSX.jsx(DFL.SliderField, { label: param.label, min: param.min, max: param.max, step: param.step, value: sliderValue(param, currentParams[param.key]), disabled: busy, onChange: (v) => handleSlider(status.preset_id, param.key, v) }, param.key)))
                        : null, filterMode === "app" && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.8em", opacity: 0.7 }, children: "Slider changes rewrite the shader file; a game that is already running keeps its compiled copy until it restarts." }) }))] }), managedCount > 0 && (SP_JSX.jsxs(DFL.PanelSection, { title: "Saved per-game filters", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.85em", opacity: 0.85 }, children: managedNames }) }), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.8em", opacity: 0.7 }, children: "These games start under Gamescope with the selected preset. Removing the wrappers restores each game's original launch options. A game that is already running keeps its filter until it restarts." }) }), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: handleRemoveWrappers, children: busy ? "Working…" : "Remove saved wrappers" })] })), !caps?.canWriteLaunchOptions && (SP_JSX.jsx(DFL.PanelSection, { title: "Steam integration", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { children: "This Steam build doesn't expose launch-option editing, so active-app mode is unavailable. System-wide mode still works." }) }) })), SP_JSX.jsxs(DFL.PanelSection, { title: "Community packs", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.85em", opacity: 0.8 }, children: "Curated shader collections from the community. Experimental \u2014 some shaders may not compile on your Gamescope build, and a community shader under the per-game wrapper is the least tested combination here. New presets appear in the list above after downloading." }) }), status.community_packs.map((pack) => (SP_JSX.jsxs("div", { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "0.9em" }, children: [SP_JSX.jsx("div", { children: pack.name }), SP_JSX.jsx("div", { style: { opacity: 0.7, fontSize: "0.9em" }, children: pack.description })] }) }), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => pack.installed
                                    ? handleRemovePack(pack.id)
                                    : handleDownloadPack(pack.id), children: busy
                                    ? "Working…"
                                    : pack.installed
                                        ? `Remove ${pack.name}`
                                        : `Download ${pack.name}` })] }, pack.id)))] })] }));
}
var index = definePlugin(() => {
    return {
        name: "DeckyCRT",
        titleView: SP_JSX.jsx("div", { className: DFL.staticClasses.Title, children: "DeckyCRT" }),
        content: SP_JSX.jsx(Content, {}),
        icon: SP_JSX.jsx(FaTv, {}),
        onDismount() { },
    };
});

export { index as default };
//# sourceMappingURL=index.js.map
