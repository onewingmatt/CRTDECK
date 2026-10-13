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

export const COMMAND_TOKEN = "%command%";

// Our shader paths are always deckycrt/…, deckycrt-heavy/… or
// deckycrt-community/…, so the directory name is enough to recognize our own
// wrapper and never someone else's.
export function isDeckyCrtShaderPath(value: string): boolean {
  return value.includes("deckycrt");
}

interface Token {
  raw: string;
  value: string;
}

const unquote = (raw: string): string => {
  let value = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && quote !== "'" && i + 1 < raw.length) {
      value += raw[++i];
    } else if (quote) {
      if (c === quote) quote = null;
      else value += c;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else {
      value += c;
    }
  }
  return value;
};

export function tokenize(options: string): Token[] {
  const tokens: Token[] = [];
  let start = -1;
  let quote: string | null = null;
  let escaped = false;
  const push = (end: number) => {
    if (start < 0) return;
    const raw = options.slice(start, end);
    tokens.push({ raw, value: unquote(raw) });
    start = -1;
  };
  for (let i = 0; i < options.length; i++) {
    const c = options[i];
    if (start < 0) {
      if (/\s/.test(c)) continue;
      start = i;
    }
    if (escaped) escaped = false;
    else if (c === "\\" && quote !== "'") escaped = true;
    else if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') quote = c;
    else if (/\s/.test(c)) push(i);
  }
  push(options.length);
  return tokens;
}

export function serialize(tokens: Token[]): string {
  return tokens.map((t) => t.raw).join(" ");
}

/** Compare two launch-option strings ignoring whitespace differences. */
export function sameOptions(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return serialize(tokenize(a)) === serialize(tokenize(b));
}

export const isCommandToken = (token: Token): boolean =>
  token.value.toLowerCase() === COMMAND_TOKEN;

const isMalformedCommandToken = (token: Token): boolean => {
  const v = token.value.toLowerCase();
  return v === "%command" || v === "command%";
};

const isAssignment = (token: Token): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.value);

const commandIndex = (tokens: Token[]): number =>
  tokens.findIndex(isCommandToken);

/** Steam accepts `%command`, `command%` and `%command%`; normalize the typo forms. */
function normalizeCommandTokens(tokens: Token[]): void {
  for (const token of tokens) {
    if (isCommandToken(token) || isMalformedCommandToken(token)) {
      token.raw = COMMAND_TOKEN;
      token.value = COMMAND_TOKEN;
    }
  }
}

export interface WrapperLocation {
  start: number;
  path: string;
}

/** Locate our own wrapper: gamescope --reshade-effect deckycrt… -- */
export function findWrapper(tokens: Token[]): WrapperLocation | null {
  for (let i = 0; i + 3 < tokens.length; i++) {
    if (
      tokens[i].value === "gamescope" &&
      tokens[i + 1].value === "--reshade-effect" &&
      isDeckyCrtShaderPath(tokens[i + 2].value) &&
      tokens[i + 3].value === "--"
    ) {
      return { start: i, path: tokens[i + 2].value };
    }
  }
  return null;
}

/** The shader path our wrapper currently points at, or null when absent. */
export function wrapperPath(options: string): string | null {
  return findWrapper(tokenize(options))?.path ?? null;
}

/**
 * A gamescope invocation in the prefix that is NOT ours. Stacking a second
 * gamescope would double-composite, so callers must refuse instead.
 */
export function hasForeignGamescopeWrapper(tokens: Token[]): boolean {
  const command = commandIndex(tokens);
  const end = command >= 0 ? command : tokens.length;
  const mine = findWrapper(tokens);
  for (let i = 0; i < end; i++) {
    if (tokens[i].value === "gamescope" && i !== mine?.start) return true;
  }
  return false;
}

export interface ChangeResult {
  options: string;
  changed: boolean;
  /**
   * True when we had to synthesize `%command%` because the options had none.
   * Steam appends bare options after the exe, so without the placeholder
   * gamescope would never be the thing being launched. Removal has to take
   * that placeholder back out again to restore the original string.
   */
  addedCommand?: boolean;
  /** Set when the write must not happen at all, with the reason. */
  blocked?: "foreign-gamescope";
}

/** Insert or re-point our wrapper. Idempotent for the same path. */
export function installWrapper(
  options: string,
  shaderPath: string
): ChangeResult {
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

  const wrapper: Token[] = [
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
export function removeWrapper(
  options: string,
  dropCommand = false
): ChangeResult {
  const tokens = tokenize(options);
  normalizeCommandTokens(tokens);
  const found = findWrapper(tokens);
  if (!found) return { options: serialize(tokens), changed: false };
  tokens.splice(found.start, 4);
  if (dropCommand) {
    const command = commandIndex(tokens);
    if (command >= 0) tokens.splice(command, 1);
  }
  return { options: serialize(tokens), changed: true };
}
