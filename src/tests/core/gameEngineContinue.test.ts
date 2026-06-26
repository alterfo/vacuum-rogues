/**
 * `GameEngine.continueGame()` is the "Continue" entry point (Task 3, save-slots
 * UI). It must resume the latest **meaningful** save across *all* slots — the
 * most recent non-terminal save, auto or manual — not just the `"auto"`
 * autosave. These tests drive the method in isolation over a fake save manager
 * + a spied `loadGame`, so they assert exactly which slot Continue picks without
 * standing up the whole engine.
 *
 * `continueGame` only touches `this.saveManager.listSlots()` (through the pure
 * `latestMeaningfulSlot` resolver) and `this.loadGame(slotId)`, so an
 * `Object.create(GameEngine.prototype)` instance with those two members wired is
 * a faithful, minimal harness.
 */
import { describe, it, expect, vi } from "vitest";

// GameEngine's import graph pulls in PixiJS-extending scene classes at module
// load; a partial mock keeps the constructable bases available (we never render).
vi.mock("pixi.js", () => ({
  Filter: class {},
  Rectangle: class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0,
    ) {}
  },
  Application: vi.fn().mockImplementation(() => ({})),
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    filters: [],
    on: vi.fn(),
    destroy: vi.fn(),
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    fill: vi.fn().mockReturnThis(),
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    moveTo: vi.fn().mockReturnThis(),
    lineTo: vi.fn().mockReturnThis(),
    on: vi.fn(),
    clear: vi.fn(),
    addChild: vi.fn(),
  })),
  Text: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    on: vi.fn(),
    destroy: vi.fn(),
  })),
  Sprite: vi.fn().mockImplementation(() => ({ anchor: { set: vi.fn() } })),
  BlurFilter: vi.fn().mockImplementation(() => ({})),
}));

import { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import type { SaveSlotInfo } from "@/types";

function slot(
  slotId: string,
  timestamp: number,
  currentSceneType: SceneType,
): SaveSlotInfo {
  return { slotId, timestamp, playerLevel: 1, location: "—", currentSceneType };
}

function makeEngine(slots: SaveSlotInfo[]) {
  const loadGame = vi.fn(async (_slotId: string) => true);
  const listSlots = vi.fn(async () => slots);
  const engine = Object.create(GameEngine.prototype) as GameEngine;
  Object.assign(engine, { saveManager: { listSlots }, loadGame });
  return { engine, loadGame, listSlots };
}

describe("GameEngine.continueGame — latest-meaningful resolver", () => {
  it("loads the most recent non-terminal save across all slots", async () => {
    const { engine, loadGame } = makeEngine([
      slot("auto", 100, SceneType.SPACE_FLIGHT),
      slot("slot-1", 300, SceneType.STAR_MAP),
      slot("slot-2", 200, SceneType.SPACE_FLIGHT),
    ]);

    const ok = await engine.continueGame();

    expect(ok).toBe(true);
    expect(loadGame).toHaveBeenCalledTimes(1);
    expect(loadGame).toHaveBeenCalledWith("slot-1");
  });

  it("skips a newer terminal (win/lose) save and resumes the latest meaningful one", async () => {
    const { engine, loadGame } = makeEngine([
      slot("auto", 500, SceneType.WIN_SCREEN), // newest, but terminal
      slot("slot-1", 200, SceneType.SPACE_FLIGHT),
    ]);

    await engine.continueGame();

    expect(loadGame).toHaveBeenCalledWith("slot-1");
  });

  it("returns false and loads nothing when no meaningful save exists", async () => {
    const { engine, loadGame } = makeEngine([
      slot("auto", 500, SceneType.GAME_OVER),
    ]);

    const ok = await engine.continueGame();

    expect(ok).toBe(false);
    expect(loadGame).not.toHaveBeenCalled();
  });

  it("returns false with no saves at all", async () => {
    const { engine, loadGame } = makeEngine([]);

    expect(await engine.continueGame()).toBe(false);
    expect(loadGame).not.toHaveBeenCalled();
  });
});
