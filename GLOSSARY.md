# Glossary

The words this plugin uses for its own domain. Use them exactly — the panel, the
backend and the tests all speak this language, and drifting off it is how the
same rule ended up written twice.

**Filter mode** — which of the three states the panel offers: **Off**,
**Active app**, **System-wide**. Read from live state, never from a stored flag.
Owned by `src/mode.ts`, which also decides whether a change is allowed.

**live effect** — the shader path Gamescope is filtering with right now, read
from its `GAMESCOPE_RESHADE_EFFECT` property. `""` means nothing is applied;
`null` means the property could not be read. The two are different answers.

**wrapper** — the string `gamescope --reshade-effect <shader> -- %command%`
saved in a game's Steam launch options. It takes effect at that game's **next**
launch; it cannot filter a copy that is already running.

**managed app** — a game the registry remembers as holding our wrapper. The
wrapper outlives the process, so the registry is the only way Off or
System-wide can find it afterwards.

**registry** — the `managed_apps` map in `~/.config/deckycrt/config.json`.

**probe** — the one module that asks the system questions
(`deckycrt_probe.py`: processes, core dumps, Gamescope's property, displays).
Every question answers `Ok(value)` or `Unknown(reason)`.

**unknown** — a real answer meaning the question could not be answered at all.
It is never collapsed into an empty or negative answer: "could not ask" and
"nothing there" lead to opposite decisions. Callers fail closed on it — they
refuse the change and say why.

**panel** — the Decky QAM interface (`src/index.tsx`).

**preset rank** — the order the preset list is served in, best first. Owned by
`PRESET_RANK` and by the measured verdicts for community shaders, so the order
is a decision in one place rather than the order the list happens to be written
in.

**verdict** — what Gamescope's shader compiler did with a community shader when
it was measured (`ok`, `reject`, `untested`), recorded in
`community/verdicts.json`. A rejected shader is silent: the write succeeds, the
effect never loads and the preset looks like it does nothing, so the list says
so instead of letting the user find out one at a time.

**backend** — `main.py`, which Decky's loader runs as the plugin's user.

**the two filters must not stack** — a game running under its own wrapper keeps
filtering until it exits, so turning on System-wide at that moment filters the
same pixels twice. Every mode change clears the other mechanism first, and
refuses to proceed when it cannot verify that.
