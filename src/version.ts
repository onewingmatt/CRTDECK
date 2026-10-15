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
export const PLUGIN_BUILD = "0.4.4-mode";
