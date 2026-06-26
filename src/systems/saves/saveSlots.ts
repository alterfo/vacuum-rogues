import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";
import { SceneType } from "@/types";
import { MAX_SLOTS } from "@/data/SaveManager";

/**
 * Pure slot-list model for the save/load UI.
 *
 * The backend (`SaveManager`) already stores up to `MAX_SLOTS` named slots in
 * IndexedDB; this module turns that flat list into ordered display rows
 * (auto + a fixed grid of manual slots) and provides the create / overwrite /
 * delete / "latest meaningful" (Continue) operations the screen drives.
 *
 * Slot *names* ride in a sibling `localStorage` key (`sr_save_names`) — the
 * same class of browser-level pref as `sr_settings`/`fontScale` — so there is
 * **no save-schema/migration change** (the save envelope is untouched).
 */

/** The autosave slot id (`GameEngine.transitionTo` writes here). */
export const AUTO_SLOT_ID = "auto";

/** Prefix for player-managed manual slots: `slot-1` … `slot-N`. */
export const MANUAL_SLOT_PREFIX = "slot-";

/** Total slots (auto + manual) — single source of truth shared with `SaveManager`. */
export const MAX_SAVE_SLOTS = MAX_SLOTS;

/** Number of manual slots (the remainder after the single auto slot). */
export const MANUAL_SLOT_COUNT = MAX_SAVE_SLOTS - 1;

/** Sibling `localStorage` key holding the `{slotId: name}` map. */
const NAMES_KEY = "sr_save_names";

/**
 * Terminal scenes never count as the "latest meaningful" save — loading one
 * would drop the player straight back onto a win/lose screen.
 */
const TERMINAL_SCENES: ReadonlySet<SceneType> = new Set([
  SceneType.WIN_SCREEN,
  SceneType.GAME_OVER,
]);

/** Minimal `SaveManager` surface the model needs — injectable for tests. */
export interface SlotManagerLike {
  listSlots(): Promise<SaveSlotInfo[]>;
  write(slotId: string, state: SaveState): Promise<void>;
  deleteSlot(slotId: string): Promise<void>;
}

/** One display row for the save/load screen (occupied or empty). */
export interface SlotRow {
  readonly slotId: string;
  readonly isAuto: boolean;
  readonly occupied: boolean;
  /** Display name (custom name if set, else a sensible default). */
  readonly name: string;
  /** Save time, or `null` for an empty slot. */
  readonly timestamp: number | null;
  /** Pre-formatted date label (`"—"` when empty). */
  readonly dateLabel: string;
  /** One-line summary (`"Ур. N · <location>"`), empty when the slot is empty. */
  readonly summary: string;
  readonly currentSceneType?: SceneType;
}

// ── Slot ids ────────────────────────────────────────────────────────────────

/** Ordered manual slot ids (`slot-1` … `slot-N`). */
export function manualSlotIds(): string[] {
  return Array.from(
    { length: MANUAL_SLOT_COUNT },
    (_, i) => `${MANUAL_SLOT_PREFIX}${i + 1}`,
  );
}

/** All slot ids in display order: auto first, then the manual grid. */
export function allSlotIds(): string[] {
  return [AUTO_SLOT_ID, ...manualSlotIds()];
}

/** Default display name for a slot when the player hasn't named it. */
export function defaultSlotName(slotId: string): string {
  if (slotId === AUTO_SLOT_ID) return "Автосохранение";
  const m = slotId.match(/^slot-(\d+)$/);
  if (m) return `Слот ${m[1]}`;
  return slotId;
}

// ── Name store (sibling localStorage key — no schema change) ──────────────────

function readNames(): Record<string, string> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(NAMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeNames(names: Record<string, string>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  } catch {
    /* storage unavailable — names degrade to defaults */
  }
}

/** Custom name for a slot, or `null` if none is set. */
export function getSlotName(slotId: string): string | null {
  const name = readNames()[slotId];
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}

/** Set (or, with an empty name, clear) a slot's custom display name. */
export function setSlotName(slotId: string, name: string): void {
  const names = readNames();
  const trimmed = name.trim();
  if (trimmed) names[slotId] = trimmed;
  else delete names[slotId];
  writeNames(names);
}

/** Drop a slot's custom name (used when the slot is deleted). */
export function clearSlotName(slotId: string): void {
  const names = readNames();
  if (slotId in names) {
    delete names[slotId];
    writeNames(names);
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** Format a save timestamp as `YYYY-MM-DD HH:MM`, or `"—"` when absent. */
export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function slotSummary(info: SaveSlotInfo): string {
  return `Ур. ${info.playerLevel} · ${info.location}`;
}

// ── Model + operations ────────────────────────────────────────────────────────

/** Build the ordered display rows for every slot (occupied + empty). */
export async function listSlotRows(
  manager: SlotManagerLike,
): Promise<SlotRow[]> {
  const slots = await manager.listSlots();
  const byId = new Map(slots.map((s) => [s.slotId, s]));
  return allSlotIds().map((slotId) => {
    const info = byId.get(slotId);
    const occupied = info !== undefined;
    const customName = getSlotName(slotId);
    return {
      slotId,
      isAuto: slotId === AUTO_SLOT_ID,
      occupied,
      name: customName ?? defaultSlotName(slotId),
      timestamp: info ? info.timestamp : null,
      dateLabel: formatTimestamp(info?.timestamp ?? null),
      summary: info ? slotSummary(info) : "",
      currentSceneType: info?.currentSceneType,
    };
  });
}

/** Write a save to a slot and, when given, record its custom display name. */
export async function saveToSlot(
  manager: SlotManagerLike,
  slotId: string,
  state: SaveState,
  name?: string,
): Promise<void> {
  await manager.write(slotId, state);
  if (typeof name === "string") setSlotName(slotId, name);
}

/** Delete a slot's save and forget its custom name. */
export async function deleteSlot(
  manager: SlotManagerLike,
  slotId: string,
): Promise<void> {
  await manager.deleteSlot(slotId);
  clearSlotName(slotId);
}

/** First unoccupied manual slot id, or `null` when the manual grid is full. */
export async function nextFreeSlot(
  manager: SlotManagerLike,
): Promise<string | null> {
  const occupied = new Set((await manager.listSlots()).map((s) => s.slotId));
  for (const id of manualSlotIds()) {
    if (!occupied.has(id)) return id;
  }
  return null;
}

/** Whether a scene is terminal (win/lose) and so not a meaningful resume point. */
export function isTerminalScene(scene: SceneType | undefined): boolean {
  return scene !== undefined && TERMINAL_SCENES.has(scene);
}

/**
 * Slot id Continue should resume — the most recent **non-terminal** save across
 * all slots (auto included), or `null` when there is nothing meaningful to load.
 */
export async function latestMeaningfulSlot(
  manager: SlotManagerLike,
): Promise<string | null> {
  // Only the visible slot universe (auto + the manual grid) is a Continue
  // candidate — never the hidden `_emergency` recovery dump or any other slot
  // the player can't see/manage.
  const known = new Set(allSlotIds());
  const candidates = (await manager.listSlots()).filter(
    (s) => known.has(s.slotId) && !isTerminalScene(s.currentSceneType),
  );
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const s of candidates) {
    if (s.timestamp > best.timestamp) best = s;
  }
  return best.slotId;
}
