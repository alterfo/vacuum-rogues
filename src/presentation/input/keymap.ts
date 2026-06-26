// Key remapping (accessibility pass,
// `docs/plans/20260625-accessibility-pass.md`, Task 3).
//
// The flight scene's keyboard shortcuts are no longer hard-coded into the
// router: each one is a named **action** (`cancel`/`runTurn`/`journal`/
// `inventory`) bound to a key through a persisted **keymap**. The pure
// `flightKeyHandler` resolves an event to an action via `resolveFlightAction`,
// so the same routing works whether the player keeps the defaults or rebinds.
//
// The keymap is a browser-level `localStorage` pref (`keymap`, default = the
// historical bindings) — the same class of client pref as
// `fontScale`/`paletteMode`/`reducedMotion`/`neuralEnabled`, so there is **no
// save-schema/migration change**. Every storage access is `typeof`/try-guarded
// so a runtime without `localStorage` degrades to the defaults / a no-op.
//
// Defaults are unchanged: `DEFAULT_KEYMAP` resolves byte-for-byte like the old
// hard-coded handler — Escape ⇒ cancel, Space (or `code:"Space"`) ⇒ runTurn,
// j/J ⇒ journal, i/I ⇒ inventory.

/** The remappable flight-scene actions, in display/resolution order. */
export type FlightAction = "cancel" | "runTurn" | "journal" | "inventory";

/** All flight actions, in a fixed order (resolution + UI listing). */
export const FLIGHT_ACTIONS: readonly FlightAction[] = [
  "cancel",
  "runTurn",
  "journal",
  "inventory",
];

/** A complete action→key binding. */
export type FlightKeymap = Record<FlightAction, string>;

/**
 * The historical bindings, verbatim. `runTurn` is the space bar (`" "`), which
 * also matches a `KeyboardEvent` whose `code` is `"Space"` (see {@link
 * keyEventMatches}); the letter actions match case-insensitively.
 */
export const DEFAULT_KEYMAP: FlightKeymap = {
  cancel: "Escape",
  runTurn: " ",
  journal: "j",
  inventory: "i",
};

/** Minimal injectable persistence store (a `Storage` subset). */
export interface KeymapStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage key holding the persisted keymap (JSON action→key map). */
export const KEYMAP_KEY = "keymap";

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): KeymapStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Key normalisation + event matching
// ---------------------------------------------------------------------------

/**
 * Canonicalise a bound key for comparison/storage: legacy `"Spacebar"` ⇒ `" "`,
 * single printable letters lower-cased (so a rebind to `"J"` and a `"j"` press
 * are the same binding), everything else (named keys like `"Escape"`/`"Enter"`,
 * digits, symbols) kept verbatim.
 */
export function normalizeKey(key: string): string {
  if (key === "Spacebar") return " ";
  return key.length === 1 ? key.toLowerCase() : key;
}

/**
 * Whether a `KeyboardEvent` triggers a given bound key. The space bar matches
 * both `event.key === " "` and `event.code === "Space"` (preserving the old
 * handler's belt-and-suspenders Space detection); other keys match their
 * normalised `event.key`.
 */
export function keyEventMatches(
  boundKey: string,
  event: { key: string; code?: string },
): boolean {
  const bound = normalizeKey(boundKey);
  if (bound === " ") return event.key === " " || event.code === "Space";
  return normalizeKey(event.key) === bound;
}

// ---------------------------------------------------------------------------
// Validation + persistence — localStorage("keymap"), same class as fontScale
// ---------------------------------------------------------------------------

/**
 * Coerce an arbitrary parsed value into a complete keymap: every action falls
 * back to its default when the stored value is missing or not a non-empty
 * string. So a partial/corrupt stored map still yields a total, usable keymap.
 */
export function sanitizeKeymap(value: unknown): FlightKeymap {
  const src = (value ?? {}) as Partial<Record<FlightAction, unknown>>;
  const out = {} as FlightKeymap;
  for (const action of FLIGHT_ACTIONS) {
    const raw = src[action];
    out[action] =
      typeof raw === "string" && raw.length > 0
        ? normalizeKey(raw)
        : DEFAULT_KEYMAP[action];
  }
  return out;
}

/**
 * The active keymap, merged over the defaults. An unset/unreadable/corrupt
 * store yields {@link DEFAULT_KEYMAP}. Pure given an injected `store`.
 */
export function currentKeymap(
  store: KeymapStore | undefined = liveStore(),
): FlightKeymap {
  if (!store) return { ...DEFAULT_KEYMAP };
  try {
    const stored = store.getItem(KEYMAP_KEY);
    if (!stored) return { ...DEFAULT_KEYMAP };
    return sanitizeKeymap(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

/**
 * Persist a keymap. Best-effort no-op when storage is unavailable or
 * write-blocked (a storage-disabled browser simply can't remember it).
 */
export function setKeymap(
  map: FlightKeymap,
  store: KeymapStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.setItem(KEYMAP_KEY, JSON.stringify(map));
  } catch {
    // Best-effort.
  }
}

/** Reset the keymap to the defaults (persisting the cleared state). */
export function resetKeymap(
  store: KeymapStore | undefined = liveStore(),
): void {
  setKeymap({ ...DEFAULT_KEYMAP }, store);
}

// ---------------------------------------------------------------------------
// Rebind + conflict detection (pure)
// ---------------------------------------------------------------------------

/** Result of a rebind attempt: the new map, or the action it would collide with. */
export type RebindResult =
  | { ok: true; map: FlightKeymap }
  | { ok: false; conflict: FlightAction };

/**
 * Rebind `action` to `key`, returning a **new** map (the input is never
 * mutated). Rebinding an action to the key it already holds is a no-op success.
 * Binding a key that another action already holds is **rejected** with that
 * action as the conflict (the UI surfaces it instead of silently double-binding
 * — a double-bound key would resolve ambiguously). An empty key is rejected as
 * a conflict with the action itself (nothing valid to bind).
 */
export function rebind(
  map: FlightKeymap,
  action: FlightAction,
  key: string,
): RebindResult {
  const next = normalizeKey(key);
  if (next.length === 0) return { ok: false, conflict: action };
  for (const other of FLIGHT_ACTIONS) {
    if (other !== action && normalizeKey(map[other]) === next)
      return { ok: false, conflict: other };
  }
  return { ok: true, map: { ...map, [action]: next } };
}

// ---------------------------------------------------------------------------
// Event → action resolution (the seam flightKeyHandler reads)
// ---------------------------------------------------------------------------

/**
 * Resolve a `KeyboardEvent` to the flight action it triggers under `map`, or
 * `null` when no action is bound to that key. Actions are tested in
 * {@link FLIGHT_ACTIONS} order so resolution is deterministic even if a corrupt
 * map double-binds a key.
 */
export function resolveFlightAction(
  event: { key: string; code?: string },
  map: FlightKeymap = currentKeymap(),
): FlightAction | null {
  for (const action of FLIGHT_ACTIONS) {
    if (keyEventMatches(map[action], event)) return action;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Human-readable labels (for the settings UI, Task 4)
// ---------------------------------------------------------------------------

/** A short, player-facing label for a bound key (e.g. `" "` ⇒ `"Пробел"`). */
export function keyLabel(key: string): string {
  const k = normalizeKey(key);
  if (k === " ") return "Пробел";
  if (k === "Escape") return "Esc";
  if (k === "ArrowUp") return "↑";
  if (k === "ArrowDown") return "↓";
  if (k === "ArrowLeft") return "←";
  if (k === "ArrowRight") return "→";
  if (k === "Enter") return "Enter";
  return k.length === 1 ? k.toUpperCase() : k;
}
