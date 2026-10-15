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

export type FilterMode = "off" | "app" | "system";

/** The mode as read from the system. `unknown` is a real answer, not a guess. */
export type ModeState = FilterMode | "unknown";

export interface LiveWrapped {
  appId: number;
  name?: string;
}

export interface ModeFacts {
  /** Gamescope's live effect: the shader path, "" for off, null when unreadable. */
  liveEffect: string | null;
  /** The foreground game's name, or null when no game is running. */
  runningApp: string | null;
  /** Its saved options: our wrapper path, "" for none, null when unreadable. */
  runningWrapper: string | null;
  /** Games the registry remembers as holding a wrapper. */
  managedNames: string[];
  /** Apps running under our wrapper right now: ids, or null when unanswerable. */
  liveWrapped: LiveWrapped[] | null;
}

export interface ModeReading {
  mode: ModeState;
  /** One line the panel can show. Never claims more than the facts support. */
  why: string;
}

export type Step =
  | { kind: "clearAppScope" }
  | { kind: "setGlobal"; enabled: boolean }
  | { kind: "wrapForeground" };

export type ModeChange =
  | { kind: "refuse"; detail: string }
  | { kind: "apply"; steps: Step[] };

const base = (path: string): string => path.split("/").pop() || path;

const names = (apps: LiveWrapped[]): string =>
  apps.map((a) => a.name || `App ${a.appId}`).join(", ");

/** How the panel refers to a set of running wrapped games, in one voice. */
export function describeApps(apps: LiveWrapped[]): string {
  return names(apps);
}

/**
 * Read the mode from the facts.
 *
 * `unknown` whenever the answer depends on something that could not be read.
 * Collapsing that to "off" is how two filters end up stacked on one picture.
 */
export function readMode(f: ModeFacts): ModeReading {
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
      why:
        f.runningWrapper && f.runningApp
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
export function planModeChange(target: FilterMode, f: ModeFacts): ModeChange {
  const unreadable = (): ModeChange => ({
    kind: "refuse",
    detail:
      "Couldn't read Gamescope's live filter state, so no mode change was made.",
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

  if (f.liveEffect === null) return unreadable();

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
        detail:
          "Couldn't tell whether a game is already running its own CRT filter, so system-wide was not enabled. Close any running game and try again.",
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
      detail:
        "Start a game first — active-app mode saves the filter in that game's launch options.",
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
