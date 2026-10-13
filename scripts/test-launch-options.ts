/**
 * Unit tests for the launch-option surgery. Run with `node
 * scripts/test-launch-options.ts` (node 22.6+ strips the types itself) or via
 * scripts/verify.sh.
 *
 * These cases are the ones that actually broke on the BC-250: a user's launch
 * options that do not start with %command%, and the requirement that removing
 * the wrapper gives back exactly what was there before.
 */

import {
  installWrapper,
  removeWrapper,
  tokenize,
  serialize,
  sameOptions,
  wrapperPath,
  hasForeignGamescopeWrapper,
} from "../src/launchOptions.ts";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`   ok   ${name}`);
  } else {
    failures++;
    console.log(`   FAIL ${name}\n        expected ${e}\n        actual   ${a}`);
  }
}

const SHADER = "deckycrt/aperture-grille.fx";
const HEAVY = "deckycrt-heavy/crt-royale.fx";

console.log("launch-option wrapper");

check("empty options gain wrapper + %command%", installWrapper("", SHADER).options,
  `gamescope --reshade-effect ${SHADER} -- %command%`);

check("plain %command% is wrapped", installWrapper("%command%", SHADER).options,
  `gamescope --reshade-effect ${SHADER} -- %command%`);

// The user's env assignment must stay BEFORE gamescope: Steam applies it to
// the process it launches, so moving it behind `--` loses it for the game.
check("leading env assignment stays first", installWrapper("PROTON_ENABLE_WAYLAND=1 %command%", SHADER).options,
  `PROTON_ENABLE_WAYLAND=1 gamescope --reshade-effect ${SHADER} -- %command%`);

check("two env assignments stay first", installWrapper("A=1 B=2 %command% --foo", SHADER).options,
  `A=1 B=2 gamescope --reshade-effect ${SHADER} -- %command% --foo`);

check("options without %command% keep assignments first", installWrapper("DXVK_HDR=1", SHADER).options,
  `DXVK_HDR=1 gamescope --reshade-effect ${SHADER} -- %command%`);

check("install is idempotent", installWrapper(
  `gamescope --reshade-effect ${SHADER} -- %command%`, SHADER),
  { options: `gamescope --reshade-effect ${SHADER} -- %command%`, changed: false });

check("preset change re-points the same wrapper", installWrapper(
  `gamescope --reshade-effect ${SHADER} -- %command%`, HEAVY).options,
  `gamescope --reshade-effect ${HEAVY} -- %command%`);

check("re-pointed wrapper is not duplicated", (() => {
  const once = installWrapper(
    `gamescope --reshade-effect ${SHADER} -- %command%`, HEAVY).options;
  return tokenize(once).filter((t) => t.value === "gamescope").length;
})(), 1);

// Removal: the whole point is that the user's string comes back, byte for byte.
for (const original of [
  "",
  "%command%",
  "PROTON_ENABLE_WAYLAND=1 %command%",
  "A=1 B=2 %command% --foo",
  "DXVK_HDR=1",
  "-novid -windowed",
]) {
  const installed = installWrapper(original, SHADER);
  const back = removeWrapper(installed.options, installed.addedCommand === true);
  check(`round-trip restores ${JSON.stringify(original)} exactly`,
    back.options, original);
}

// Without the flag the synthesized %command% stays behind — which is why the
// flag has to be persisted alongside the wrapper.
check("without the flag a bare placeholder is left behind",
  removeWrapper(installWrapper("", SHADER).options).options, "%command%");

check("legacy prefix wrapper (pre-token build) is removed", removeWrapper(
  `gamescope --reshade-effect ${SHADER} -- PROTON_ENABLE_WAYLAND=1 %command%`).options,
  "PROTON_ENABLE_WAYLAND=1 %command%");

check("remove with nothing to do reports no change", removeWrapper("PROTON_ENABLE_WAYLAND=1 %command%"),
  { options: "PROTON_ENABLE_WAYLAND=1 %command%", changed: false });

check("remove strips only our tokens", removeWrapper(
  `gamescope --reshade-effect ${SHADER} -- /usr/bin/mangohud %command%`).options,
  "/usr/bin/mangohud %command%");

check("malformed %command typo is normalized", installWrapper("%command", SHADER).options,
  `gamescope --reshade-effect ${SHADER} -- %command%`);

check("quoted shader paths survive quoting", wrapperPath(
  `gamescope --reshade-effect "${SHADER}" -- %command%`), SHADER);

// A foreign gamescope wrapper (another plugin's, or hand-written) must not be
// stacked under: two gamescope instances double-composite.
const foreign = "gamescope -f --reshade-effect /other/x.fx -- %command%";
check("foreign gamescope wrapper is detected",
  hasForeignGamescopeWrapper(tokenize(foreign)), true);
check("foreign gamescope wrapper blocks the install",
  installWrapper(foreign, SHADER).blocked, "foreign-gamescope");
check("our own wrapper does not count as foreign",
  hasForeignGamescopeWrapper(tokenize(`gamescope --reshade-effect ${SHADER} -- %command%`)), false);

check("serialize is stable over repeated tokenize", (() => {
  const s = `A=1 gamescope --reshade-effect ${SHADER} -- %command%`;
  return serialize(tokenize(serialize(tokenize(s)))) === serialize(tokenize(s));
})(), true);

if (failures) {
  console.error(`\n${failures} failure(s)`);
  (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
}
console.log("\nall launch-option cases pass");
