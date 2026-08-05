import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";
import { SceneType } from "@/types";
import { MAX_SLOTS } from "@/data/SaveManager";

export const AUTO_SLOT_ID = "auto";

export const MANUAL_SLOT_PREFIX = "slot-";

export const MAX_SAVE_SLOTS = MAX_SLOTS;

export const MANUAL_SLOT_COUNT = MAX_SAVE_SLOTS - 1;

const NAMES_KEY = "sr_save_names";

const TERMINAL_SCENES: ReadonlySet<SceneType> = new Set([
  SceneType.WIN_SCREEN,
  SceneType.GAME_OVER,
]);

export interface SlotManagerLike {
  listSlots(): Promise<SaveSlotInfo[]>;
  write(slotId: string, state: SaveState): Promise<void>;
  deleteSlot(slotId: string): Promise<void>;
}

export interface SlotRow {
  readonly slotId: string;
  readonly isAuto: boolean;
  readonly occupied: boolean;
  readonly name: string;
  readonly timestamp: number | null;
  readonly dateLabel: string;
  readonly summary: string;
  readonly currentSceneType?: SceneType;
}

export function manualSlotIds(): string[] {
  return Array.from(
    { length: MANUAL_SLOT_COUNT },
    (_, i) => `${MANUAL_SLOT_PREFIX}${i + 1}`,
  );
}

export function allSlotIds(): string[] {
  return [AUTO_SLOT_ID, ...manualSlotIds()];
}

export function defaultSlotName(slotId: string): string {
  if (slotId === AUTO_SLOT_ID) return "Автосохранение";
  const m = slotId.match(/^slot-(\d+)$/);
  if (m) return `Слот ${m[1]}`;
  return slotId;
}

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

export function getSlotName(slotId: string): string | null {
  const name = readNames()[slotId];
  return typeof name === "string" && name.trim().length > 0 ? name : null;
}

export function setSlotName(slotId: string, name: string): void {
  const names = readNames();
  const trimmed = name.trim();
  if (trimmed) names[slotId] = trimmed;
  else delete names[slotId];
  writeNames(names);
}

export function clearSlotName(slotId: string): void {
  const names = readNames();
  if (slotId in names) {
    delete names[slotId];
    writeNames(names);
  }
}

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

export async function saveToSlot(
  manager: SlotManagerLike,
  slotId: string,
  state: SaveState,
  name?: string,
): Promise<void> {
  await manager.write(slotId, state);
  if (typeof name === "string") setSlotName(slotId, name);
}

export async function deleteSlot(
  manager: SlotManagerLike,
  slotId: string,
): Promise<void> {
  await manager.deleteSlot(slotId);
  clearSlotName(slotId);
}

export async function nextFreeSlot(
  manager: SlotManagerLike,
): Promise<string | null> {
  const occupied = new Set((await manager.listSlots()).map((s) => s.slotId));
  for (const id of manualSlotIds()) {
    if (!occupied.has(id)) return id;
  }
  return null;
}

export function isTerminalScene(scene: SceneType | undefined): boolean {
  return scene !== undefined && TERMINAL_SCENES.has(scene);
}

export async function latestMeaningfulSlot(
  manager: SlotManagerLike,
): Promise<string | null> {
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
