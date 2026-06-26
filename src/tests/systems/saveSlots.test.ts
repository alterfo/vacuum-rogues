import { beforeEach, describe, expect, it } from "vitest";
import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";
import { SceneType } from "@/types";
import {
  AUTO_SLOT_ID,
  MAX_SAVE_SLOTS,
  MANUAL_SLOT_COUNT,
  allSlotIds,
  manualSlotIds,
  defaultSlotName,
  formatTimestamp,
  listSlotRows,
  saveToSlot,
  deleteSlot,
  nextFreeSlot,
  latestMeaningfulSlot,
  isTerminalScene,
  getSlotName,
  type SlotManagerLike,
} from "@/systems/saves/saveSlots";

/** In-memory manager exposing exactly the `SlotManagerLike` surface. */
class FakeSlotManager implements SlotManagerLike {
  readonly rows = new Map<string, SaveSlotInfo>();

  async listSlots(): Promise<SaveSlotInfo[]> {
    return [...this.rows.values()];
  }

  async write(slotId: string, state: SaveState): Promise<void> {
    this.rows.set(slotId, {
      slotId,
      timestamp: state.timestamp,
      playerLevel: state.player.level,
      location: state.player.ship.name,
      currentSceneType: state.currentSceneType,
    });
  }

  async deleteSlot(slotId: string): Promise<void> {
    this.rows.delete(slotId);
  }

  /** Test helper: inject a slot listing directly. */
  setRow(info: SaveSlotInfo): void {
    this.rows.set(info.slotId, info);
  }
}

function fakeState(opts: {
  ts: number;
  level: number;
  ship: string;
  scene?: SceneType;
}): SaveState {
  return {
    timestamp: opts.ts,
    player: { level: opts.level, ship: { name: opts.ship } },
    currentSceneType: opts.scene,
  } as unknown as SaveState;
}

beforeEach(() => {
  localStorage.clear();
});

describe("saveSlots — slot ids", () => {
  it("exposes auto + (MAX-1) manual slots, auto first", () => {
    expect(MANUAL_SLOT_COUNT).toBe(MAX_SAVE_SLOTS - 1);
    expect(allSlotIds().length).toBe(MAX_SAVE_SLOTS);
    expect(allSlotIds()[0]).toBe(AUTO_SLOT_ID);
    expect(manualSlotIds()).toEqual(
      Array.from({ length: MANUAL_SLOT_COUNT }, (_, i) => `slot-${i + 1}`),
    );
  });

  it("derives default names per slot kind", () => {
    expect(defaultSlotName(AUTO_SLOT_ID)).toBe("Автосохранение");
    expect(defaultSlotName("slot-3")).toBe("Слот 3");
  });

  it("formats timestamps and empties", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(0)).toBe("—");
    expect(formatTimestamp(Date.now())).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
  });
});

describe("saveSlots — listSlotRows", () => {
  it("returns one row per slot reflecting occupied/empty", async () => {
    const m = new FakeSlotManager();
    m.setRow({
      slotId: AUTO_SLOT_ID,
      timestamp: 1000,
      playerLevel: 5,
      location: "Корвет «Шершень»",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });
    m.setRow({
      slotId: "slot-1",
      timestamp: 2000,
      playerLevel: 7,
      location: "Станция Веста",
      currentSceneType: SceneType.STATION,
    });

    const rows = await listSlotRows(m);
    expect(rows.length).toBe(MAX_SAVE_SLOTS);

    const auto = rows[0];
    expect(auto.slotId).toBe(AUTO_SLOT_ID);
    expect(auto.isAuto).toBe(true);
    expect(auto.occupied).toBe(true);
    expect(auto.summary).toContain("Ур. 5");
    expect(auto.summary).toContain("Корвет «Шершень»");
    expect(auto.dateLabel).not.toBe("—");

    const slot1 = rows.find((r) => r.slotId === "slot-1")!;
    expect(slot1.occupied).toBe(true);
    expect(slot1.summary).toContain("Ур. 7");

    const empty = rows.find((r) => r.slotId === "slot-2")!;
    expect(empty.occupied).toBe(false);
    expect(empty.summary).toBe("");
    expect(empty.dateLabel).toBe("—");
    expect(empty.timestamp).toBeNull();
    expect(empty.name).toBe("Слот 2");
  });
});

describe("saveSlots — operations", () => {
  it("saveToSlot writes the save and records a custom name", async () => {
    const m = new FakeSlotManager();
    await saveToSlot(
      m,
      "slot-1",
      fakeState({ ts: 1234, level: 3, ship: "Корвет" }),
      "Перед боссом",
    );

    expect(
      (await m.listSlots()).find((s) => s.slotId === "slot-1"),
    ).toBeDefined();
    expect(getSlotName("slot-1")).toBe("Перед боссом");

    const rows = await listSlotRows(m);
    expect(rows.find((r) => r.slotId === "slot-1")!.name).toBe("Перед боссом");
  });

  it("saveToSlot without a name keeps the default display name", async () => {
    const m = new FakeSlotManager();
    await saveToSlot(m, "slot-1", fakeState({ ts: 1, level: 1, ship: "X" }));
    expect(getSlotName("slot-1")).toBeNull();
    const rows = await listSlotRows(m);
    expect(rows.find((r) => r.slotId === "slot-1")!.name).toBe("Слот 1");
  });

  it("deleteSlot removes the save and clears its name", async () => {
    const m = new FakeSlotManager();
    await saveToSlot(
      m,
      "slot-1",
      fakeState({ ts: 1, level: 1, ship: "X" }),
      "Имя",
    );
    await deleteSlot(m, "slot-1");

    expect(
      (await m.listSlots()).find((s) => s.slotId === "slot-1"),
    ).toBeUndefined();
    expect(getSlotName("slot-1")).toBeNull();
  });

  it("nextFreeSlot returns the first empty manual slot, then null when full", async () => {
    const m = new FakeSlotManager();
    expect(await nextFreeSlot(m)).toBe("slot-1");

    // Fill every manual slot.
    for (const id of manualSlotIds()) {
      m.setRow({ slotId: id, timestamp: 1, playerLevel: 1, location: "X" });
    }
    expect(await nextFreeSlot(m)).toBeNull();

    // The auto slot does not count as a manual free slot.
    m.rows.delete("slot-1");
    m.setRow({
      slotId: AUTO_SLOT_ID,
      timestamp: 1,
      playerLevel: 1,
      location: "X",
    });
    expect(await nextFreeSlot(m)).toBe("slot-1");
  });

  it("respects MAX_SAVE_SLOTS (auto + manual grid)", () => {
    expect(allSlotIds().length).toBe(MAX_SAVE_SLOTS);
    expect(new Set(allSlotIds()).size).toBe(MAX_SAVE_SLOTS);
  });
});

describe("saveSlots — Continue resolver", () => {
  it("flags terminal scenes", () => {
    expect(isTerminalScene(SceneType.WIN_SCREEN)).toBe(true);
    expect(isTerminalScene(SceneType.GAME_OVER)).toBe(true);
    expect(isTerminalScene(SceneType.SPACE_FLIGHT)).toBe(false);
    expect(isTerminalScene(undefined)).toBe(false);
  });

  it("picks the most recent non-terminal save", async () => {
    const m = new FakeSlotManager();
    m.setRow({
      slotId: AUTO_SLOT_ID,
      timestamp: 100,
      playerLevel: 1,
      location: "A",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });
    m.setRow({
      slotId: "slot-1",
      timestamp: 300,
      playerLevel: 2,
      location: "B",
      currentSceneType: SceneType.STATION,
    });
    m.setRow({
      slotId: "slot-2",
      timestamp: 200,
      playerLevel: 3,
      location: "C",
      currentSceneType: SceneType.PLANET,
    });
    expect(await latestMeaningfulSlot(m)).toBe("slot-1");
  });

  it("skips terminal saves even if they are newest", async () => {
    const m = new FakeSlotManager();
    m.setRow({
      slotId: AUTO_SLOT_ID,
      timestamp: 100,
      playerLevel: 1,
      location: "A",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });
    m.setRow({
      slotId: "slot-1",
      timestamp: 999,
      playerLevel: 9,
      location: "Конец",
      currentSceneType: SceneType.GAME_OVER,
    });
    expect(await latestMeaningfulSlot(m)).toBe(AUTO_SLOT_ID);
  });

  it("returns null when there is nothing meaningful to load", async () => {
    const m = new FakeSlotManager();
    expect(await latestMeaningfulSlot(m)).toBeNull();

    m.setRow({
      slotId: "slot-1",
      timestamp: 50,
      playerLevel: 1,
      location: "X",
      currentSceneType: SceneType.WIN_SCREEN,
    });
    expect(await latestMeaningfulSlot(m)).toBeNull();
  });
});
