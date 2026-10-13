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

// Matches both deckycrt/... and deckycrt-heavy/... wrapper paths.
const WRAPPER_MARKER = "--reshade-effect deckycrt";
// Decky plugins run inside Steam's UI, where the real SteamClient is on
// window. Feature-detect everything: this build does NOT expose
// SteamClient.Apps.GetAppDetails, and calling it unguarded throws inside a
// React effect, which takes the whole panel down (the "Decky menu crashes"
// failure). Other plugins on this box (BC250-Toolkit) guard the same way.
function steamRoot() {
    return window.SteamClient;
}
function canWatchGameSessions() {
    return (typeof steamRoot()?.GameSessions?.RegisterForAppLifetimeNotifications ===
        "function");
}
function canReadLaunchOptions() {
    if (typeof steamRoot()?.Apps?.GetAppDetails === "function")
        return true;
    return typeof window.appDetailsStore?.GetAppDetails === "function";
}
// Returns null when the launch options could NOT be read. Callers must never
// treat null as "" — writing "" would wipe the user's real launch options.
async function readLaunchOptions(appId) {
    try {
        const apps = steamRoot()?.Apps;
        if (typeof apps?.GetAppDetails === "function") {
            const d = await apps.GetAppDetails(appId);
            if (typeof d?.strLaunchOptions === "string")
                return d.strLaunchOptions;
        }
        const store = window.appDetailsStore;
        if (typeof store?.GetAppDetails === "function") {
            if (typeof store.RequestAppDetails === "function") {
                await store.RequestAppDetails(appId);
            }
            const d2 = store.GetAppDetails(appId);
            if (typeof d2?.strLaunchOptions === "string")
                return d2.strLaunchOptions;
        }
    }
    catch {
        /* fall through to null */
    }
    return null;
}
// A rejected backend call must never surface as a raw panel error — that is
// what the "an error occurred in DeckyCRT" banner actually is.
function toastError(what, e) {
    toaster.toast({
        title: "DeckyCRT",
        body: `${what} failed — see the plugin log`,
    });
    console.error("DeckyCRT:", what, e);
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
function Content() {
    const [status, setStatus] = SP_REACT.useState(null);
    const [runningApp, setRunningApp] = SP_REACT.useState(null);
    const [perGameOn, setPerGameOn] = SP_REACT.useState(false);
    const [perGameAvailable, setPerGameAvailable] = SP_REACT.useState(false);
    const [busy, setBusy] = SP_REACT.useState(false);
    const debounceTimers = SP_REACT.useRef({});
    const refresh = async () => {
        try {
            setStatus(await getStatus());
        }
        catch (e) {
            toastError("Status refresh", e);
        }
    };
    // Initial load: make sure shaders are installed, watch for running games.
    SP_REACT.useEffect(() => {
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
        // Per-game mode needs APIs that not every Steam build exposes. Detect once;
        // never call a missing method (that is what crashes the panel).
        const canWatch = canWatchGameSessions();
        const canRead = canReadLaunchOptions();
        setPerGameAvailable(canWatch && canRead);
        if (!canWatch)
            return;
        let unregister = null;
        try {
            const register = steamRoot().GameSessions.RegisterForAppLifetimeNotifications;
            unregister = register((data) => {
                // Non-Steam shortcut appids arrive as signed int32.
                const appId = data.unAppID >>> 0;
                if (!data.bRunning) {
                    setRunningApp(null);
                    return;
                }
                // Only reached when the API passed detection; keep it defensive anyway.
                const apps = steamRoot()?.Apps;
                if (typeof apps?.GetAppDetails === "function") {
                    Promise.resolve(apps.GetAppDetails(appId))
                        .then((d) => setRunningApp({
                        appId,
                        name: d?.strDisplayName ?? `App ${appId}`,
                    }))
                        .catch(() => setRunningApp({ appId, name: `App ${appId}` }));
                }
                else {
                    setRunningApp({ appId, name: `App ${appId}` });
                }
            });
        }
        catch (e) {
            toastError("Game session watch", e);
        }
        return () => {
            try {
                if (typeof unregister === "function")
                    unregister();
                else if (typeof unregister?.unregister === "function") {
                    unregister.unregister();
                }
            }
            catch {
                /* the panel is unloading anyway */
            }
        };
    }, []);
    // Sync the per-game toggle when the running app changes.
    SP_REACT.useEffect(() => {
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
    const currentParams = (status && currentPreset && status.params[currentPreset.id]) ?? {};
    const presetOptions = (status?.presets ?? []).map((p) => ({
        data: p.id,
        label: p.name + (p.heavy ? " (heavy)" : ""),
    }));
    const handlePreset = async (presetId) => {
        try {
            const res = await setPreset(presetId);
            if (!res.ok) {
                toaster.toast({ title: "DeckyCRT", body: res.detail });
                return;
            }
            await refresh();
        }
        catch (e) {
            toastError("Preset switch", e);
        }
    };
    const handleGlobalToggle = async (enable) => {
        try {
            const res = await setGlobalEnabled(enable);
            toaster.toast({ title: "DeckyCRT", body: res.detail });
            await refresh();
        }
        catch (e) {
            toastError("Global toggle", e);
        }
    };
    const handleSlider = (presetId, key, value) => {
        // Optimistic UI update; bake into the shader file after a short pause.
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
                    toaster.toast({ title: "DeckyCRT", body: res.detail });
            }
            catch (e) {
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
            toaster.toast({ title: "DeckyCRT", body: res.detail });
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
            toaster.toast({ title: "DeckyCRT", body: res.detail });
            await refresh();
        }
        catch (e) {
            toastError("Pack removal", e);
        }
    };
    const handlePerGame = async (enable) => {
        if (!runningApp || !status)
            return;
        if (!perGameAvailable) {
            toaster.toast({
                title: "DeckyCRT",
                body: "This Steam build doesn't expose app launch options.",
            });
            return;
        }
        const rel = status.presets.find((p) => p.id === status.preset_id)?.relpath ?? "";
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
        }
        else {
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
        }
        catch {
            toaster.toast({ title: "DeckyCRT", body: "Failed to update launch options." });
        }
    };
    if (!status) {
        return (SP_JSX.jsx(DFL.PanelSection, { title: "DeckyCRT", children: SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { children: "Loading\u2026" }) }) }));
    }
    const showHeavyDownload = currentPreset?.heavy && !status.heavy_installed;
    return (SP_JSX.jsxs(SP_JSX.Fragment, { children: [SP_JSX.jsxs(DFL.PanelSection, { title: "CRT filter", children: [!status.reshade_supported && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { children: "Gamescope ReShade support not detected. Shaders can't be applied on this system." }) })), SP_JSX.jsx(DFL.ToggleField, { label: "Global CRT (whole screen)", description: status.xprop_available
                            ? "Applies the shader to the entire Gamescope session."
                            : "Unavailable: needs xprop in this session.", checked: status.global_enabled, disabled: !status.xprop_available || !status.reshade_supported, onChange: handleGlobalToggle }), SP_JSX.jsx(DFL.DropdownItem, { label: "Preset", rgOptions: presetOptions, selectedOption: presetOptions.find((o) => o.data === status.preset_id) ??
                            presetOptions[0], onChange: (opt) => handlePreset(opt.data) }), currentPreset && (SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.85em", opacity: 0.8 }, children: currentPreset.description }) })), showHeavyDownload && (SP_JSX.jsx(DFL.ButtonItem, { layout: "below", onClick: handleDownloadHeavy, disabled: busy, children: busy ? "Downloading…" : "Download CRT-Royale (heavy)" })), (currentPreset?.params ?? [])
                        .filter(paramIsUsable)
                        .slice(0, 12)
                        .map((param) => (SP_JSX.jsx(DFL.SliderField, { label: param.label, min: param.min, max: param.max, step: param.step, value: sliderValue(param, currentParams[param.key]), onChange: (v) => handleSlider(status.preset_id, param.key, v) }, param.key))), SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.8em", opacity: 0.7 }, children: "Global and per-game stack \u2014 use one or the other, not both." }) })] }), runningApp && (SP_JSX.jsx(DFL.PanelSection, { title: "This game", children: SP_JSX.jsx(DFL.ToggleField, { label: runningApp.name, description: perGameAvailable
                        ? "Wrap this game's launch options in Gamescope + CRT."
                        : "Unavailable: this Steam build doesn't expose app launch options.", checked: perGameOn, disabled: !status.reshade_supported || !perGameAvailable, onChange: handlePerGame }) })), SP_JSX.jsxs(DFL.PanelSection, { title: "Community packs", children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsx("div", { style: { fontSize: "0.85em", opacity: 0.8 }, children: "Curated shader collections from the community. Experimental \u2014 some shaders may not compile on your Gamescope build. New presets appear in the list above after downloading." }) }), status.community_packs.map((pack) => (SP_JSX.jsxs("div", { children: [SP_JSX.jsx(DFL.PanelSectionRow, { children: SP_JSX.jsxs("div", { style: { fontSize: "0.9em" }, children: [SP_JSX.jsx("div", { children: pack.name }), SP_JSX.jsx("div", { style: { opacity: 0.7, fontSize: "0.9em" }, children: pack.description })] }) }), SP_JSX.jsx(DFL.ButtonItem, { layout: "below", disabled: busy, onClick: () => pack.installed
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
