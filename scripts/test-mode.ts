/**
 * Drive the filter-mode module without Steam, Gamescope or a renderer.
 *
 * The panel's mode logic used to be reachable only by mounting the panel, which
 * is why it was patched four times without a test. This exercises the reading
 * and the refusal rule directly — no new dependencies, plain node, the same way
 * `scripts/test-launch-options.ts` runs.
 *
 * Run: node scripts/test-mode.ts
 */

import { planModeChange, readMode } from "../src/mode.ts";
import type { ModeFacts, ModeChange, Step } from "../src/mode.ts";

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

function facts(over: Partial<ModeFacts> = {}): ModeFacts {
  return {
    liveEffect: "",
    runningApp: null,
    runningWrapper: "",
    managedNames: [],
    liveWrapped: [],
    ...over,
  };
}

const stepKinds = (change: ModeChange): string[] =>
  change.kind === "apply" ? change.steps.map((s: Step) => s.kind) : ["refuse"];

console.log("mode: reading the live state");
check("a live effect reads as system",
  readMode(facts({ liveEffect: "/x/deckycrt/crt-pro.fx" })).mode, "system");
check("an unreadable effect reads as unknown",
  readMode(facts({ liveEffect: null })).mode, "unknown");
check("nothing live and nothing saved reads as off",
  readMode(facts()).mode, "off");
check("a saved wrapper reads as app",
  readMode(facts({ managedNames: ["Risk of Rain Returns"] })).mode, "app");
check("the running game's saved wrapper reads as app",
  readMode(facts({ runningApp: "Risk of Rain Returns", runningWrapper: "deckycrt/a.fx" })).mode,
  "app");
check("a running game whose options are unreadable reads as unknown",
  readMode(facts({ runningApp: "Risk of Rain Returns", runningWrapper: null })).mode,
  "unknown");
check("unreadable options are not read as off",
  readMode(facts({ runningApp: "Risk of Rain Returns", runningWrapper: null })).mode === "off",
  false);
check("the system reading names the shader",
  readMode(facts({ liveEffect: "/x/deckycrt/crt-pro.fx" })).why.includes("crt-pro.fx"),
  true);

console.log("mode: switching to System-wide");
check("a wrapped game already running refuses the switch",
  planModeChange("system", facts({ liveWrapped: [{ appId: 1337520, name: "Risk of Rain Returns" }] })).kind,
  "refuse");
check("the refusal names the game",
  (planModeChange("system", facts({ liveWrapped: [{ appId: 1337520, name: "Risk of Rain Returns" }] })) as {
    detail: string;
  }).detail.includes("Risk of Rain Returns"),
  true);
check("an unanswerable running-wrapper probe refuses the switch",
  planModeChange("system", facts({ liveWrapped: null })).kind, "refuse");
check("an unreadable live state refuses the switch",
  planModeChange("system", facts({ liveEffect: null })).kind, "refuse");
check("an unreadable game's options refuse the switch",
  planModeChange("system", facts({ runningApp: "RORR", runningWrapper: null })).kind,
  "refuse");
check("a clear picture applies the switch",
  stepKinds(planModeChange("system", facts())), ["clearAppScope", "setGlobal"]);
check("the saved wrappers are cleared before the filter goes on",
  stepKinds(planModeChange("system", facts())), ["clearAppScope", "setGlobal"]);

console.log("mode: switching to Active app");
check("with no game running it refuses",
  planModeChange("app", facts()).kind, "refuse");
check("the refusal tells the user to start a game",
  (planModeChange("app", facts()) as { detail: string }).detail.includes("Start a game first"),
  true);
check("with the game's options unreadable it refuses",
  planModeChange("app", facts({ runningApp: "RORR", runningWrapper: null })).kind,
  "refuse");
check("with a live filter it still refuses on an unreadable live state",
  planModeChange("app", facts({ liveEffect: null, runningApp: "RORR", runningWrapper: "" })).kind,
  "refuse");
check("the live filter comes off before the wrapper is saved",
  stepKinds(planModeChange("app", facts({ runningApp: "RORR" }))),
  ["setGlobal", "wrapForeground"]);

console.log("mode: switching Off");
check("Off is never refused",
  planModeChange("off", facts({ liveEffect: null, liveWrapped: null })).kind, "apply");
check("Off clears the wrappers then the whole-screen filter",
  stepKinds(planModeChange("off", facts())), ["clearAppScope", "setGlobal"]);
check("Off turns the global filter off",
  (planModeChange("off", facts()) as { steps: Step[] }).steps[1],
  { kind: "setGlobal", enabled: false });

if (failures) {
  console.error(`\n${failures} failure(s)`);
  (globalThis as { process?: { exit(code: number): void } }).process?.exit(1);
}
console.log("\nall filter-mode cases pass");
