export type FlightAction = "cancel" | "runTurn" | "journal" | "inventory";

export const FLIGHT_ACTIONS: readonly FlightAction[] = [
  "cancel",
  "runTurn",
  "journal",
  "inventory",
];

export type FlightKeymap = Record<FlightAction, string>;

export const DEFAULT_KEYMAP: FlightKeymap = {
  cancel: "Escape",
  runTurn: " ",
  journal: "j",
  inventory: "i",
};

export interface KeymapStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const KEYMAP_KEY = "keymap";

function liveStore(): KeymapStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeKey(key: string): string {
  if (key === "Spacebar") return " ";
  return key.length === 1 ? key.toLowerCase() : key;
}

export function keyEventMatches(
  boundKey: string,
  event: { key: string; code?: string },
): boolean {
  const bound = normalizeKey(boundKey);
  if (bound === " ") return event.key === " " || event.code === "Space";
  return normalizeKey(event.key) === bound;
}

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

export function resetKeymap(
  store: KeymapStore | undefined = liveStore(),
): void {
  setKeymap({ ...DEFAULT_KEYMAP }, store);
}

export type RebindResult =
  | { ok: true; map: FlightKeymap }
  | { ok: false; conflict: FlightAction };

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

export function resolveFlightAction(
  event: { key: string; code?: string },
  map: FlightKeymap = currentKeymap(),
): FlightAction | null {
  for (const action of FLIGHT_ACTIONS) {
    if (keyEventMatches(map[action], event)) return action;
  }
  return null;
}

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
