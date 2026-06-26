/**
 * SaveLoadScene wires the pure slot-list model (`@/systems/saves/saveSlots`) to
 * the screen: rows come from `listSlotRows`, and each action delegates to the
 * model / `GameEngine`. These tests drive the public action methods directly
 * (no PixiJS pointer events); `render()` no-ops without a real renderer, so the
 * scene runs headless with a `{}` renderer stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveLoadScene } from "@/presentation/SaveLoadScene";
import { SceneType } from "@/types";
import type { SaveSlotInfo } from "@/types";
import type { SaveState } from "@/domain/SaveState";
import type { GameEngine } from "@/systems/GameEngine";
import {
  AUTO_SLOT_ID,
  MAX_SAVE_SLOTS,
  getSlotName,
  type SlotManagerLike,
} from "@/systems/saves/saveSlots";

class FakeSlotManager implements SlotManagerLike {
  readonly rows = new Map<string, SaveSlotInfo>();
  listSlots = vi.fn(
    async (): Promise<SaveSlotInfo[]> => [...this.rows.values()],
  );
  write = vi.fn(async (slotId: string, state: SaveState): Promise<void> => {
    this.rows.set(slotId, {
      slotId,
      timestamp: state.timestamp,
      playerLevel: state.player.level,
      location: state.player.ship.name,
      currentSceneType: state.currentSceneType,
    });
  });
  deleteSlot = vi.fn(async (slotId: string): Promise<void> => {
    this.rows.delete(slotId);
  });
  setRow(info: SaveSlotInfo): void {
    this.rows.set(info.slotId, info);
  }
}

function makeScene(opts: { withGame?: boolean } = {}) {
  const manager = new FakeSlotManager();
  const saveGame = vi.fn(async (slotId: string) => {
    manager.setRow({
      slotId,
      timestamp: Date.now(),
      playerLevel: 3,
      location: "Корвет",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });
  });
  const loadGame = vi.fn(async () => true);
  const transitionTo = vi.fn(async () => undefined);
  const gameEngine = {
    saveManager: manager,
    player: opts.withGame ? {} : null,
    galaxy: opts.withGame ? {} : null,
    saveGame,
    loadGame,
    transitionTo,
  } as unknown as GameEngine;

  const scene = new SaveLoadScene({} as never);
  (scene as unknown as { gameEngine: GameEngine | null }).gameEngine =
    gameEngine;
  return { scene, manager, saveGame, loadGame, transitionTo };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SaveLoadScene — rows", () => {
  it("lists a row per slot (auto + manual grid), reflecting occupied/empty", async () => {
    const { scene, manager } = makeScene();
    manager.setRow({
      slotId: "slot-1",
      timestamp: 1000,
      playerLevel: 5,
      location: "Корвет",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });

    await scene.refresh();

    const rows = scene.getRows();
    expect(rows).toHaveLength(MAX_SAVE_SLOTS);
    expect(rows[0].slotId).toBe(AUTO_SLOT_ID);
    expect(rows.find((r) => r.slotId === "slot-1")?.occupied).toBe(true);
    expect(rows.find((r) => r.slotId === "slot-2")?.occupied).toBe(false);
    expect(manager.listSlots).toHaveBeenCalled();
  });
});

describe("SaveLoadScene — actions delegate to the model/engine", () => {
  it("loadSlot delegates to GameEngine.loadGame", async () => {
    const { scene, loadGame } = makeScene();
    await scene.loadSlot("slot-1");
    expect(loadGame).toHaveBeenCalledWith("slot-1");
  });

  it("saveSlot writes through GameEngine.saveGame and records the name", async () => {
    const { scene, saveGame } = makeScene({ withGame: true });
    await scene.saveSlot("slot-2", "Перед боссом");
    expect(saveGame).toHaveBeenCalledWith("slot-2");
    expect(getSlotName("slot-2")).toBe("Перед боссом");
    // The row list refreshed to include the new save.
    expect(scene.getRows().find((r) => r.slotId === "slot-2")?.occupied).toBe(
      true,
    );
  });

  it("saveSlot is a no-op without an active game", async () => {
    const { scene, saveGame } = makeScene({ withGame: false });
    expect(scene.canSave()).toBe(false);
    await scene.saveSlot("slot-2", "x");
    expect(saveGame).not.toHaveBeenCalled();
  });

  it("removeSlot deletes through the model and re-lists", async () => {
    const { scene, manager } = makeScene();
    manager.setRow({
      slotId: "slot-3",
      timestamp: 2000,
      playerLevel: 2,
      location: "Корвет",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });

    await scene.refresh();
    expect(scene.getRows().find((r) => r.slotId === "slot-3")?.occupied).toBe(
      true,
    );

    await scene.removeSlot("slot-3");
    expect(manager.deleteSlot).toHaveBeenCalledWith("slot-3");
    expect(scene.getRows().find((r) => r.slotId === "slot-3")?.occupied).toBe(
      false,
    );
  });

  it("confirmPending carries out an armed delete", async () => {
    const { scene, manager } = makeScene();
    manager.setRow({
      slotId: "slot-4",
      timestamp: 3000,
      playerLevel: 1,
      location: "Корвет",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });
    await scene.refresh();

    scene.requestConfirm("slot-4", "delete");
    await scene.confirmPending();

    expect(manager.deleteSlot).toHaveBeenCalledWith("slot-4");
  });

  it("goBack returns to the requested scene", async () => {
    const { scene, transitionTo } = makeScene();
    (scene as unknown as { returnTo: SceneType }).returnTo =
      SceneType.MAIN_MENU;
    scene.goBack();
    expect(transitionTo).toHaveBeenCalledWith(
      SceneType.MAIN_MENU,
      expect.objectContaining({ gameEngine: expect.anything() }),
    );
  });

  it("confirmPending carries out an armed overwrite (re-prompts the name + saves)", async () => {
    const { scene, manager, saveGame } = makeScene({ withGame: true });
    manager.setRow({
      slotId: "slot-2",
      timestamp: 1000,
      playerLevel: 2,
      location: "Корвет",
      currentSceneType: SceneType.SPACE_FLIGHT,
    });
    await scene.refresh();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Новое имя");

    scene.requestConfirm("slot-2", "overwrite");
    await scene.confirmPending();

    expect(prompt).toHaveBeenCalled();
    expect(saveGame).toHaveBeenCalledWith("slot-2");
    expect(getSlotName("slot-2")).toBe("Новое имя");
  });

  it("createSave prompts for a name and writes the empty slot", async () => {
    const { scene, saveGame } = makeScene({ withGame: true });
    vi.spyOn(window, "prompt").mockReturnValue("Свежий старт");

    await scene.createSave("slot-5");

    expect(saveGame).toHaveBeenCalledWith("slot-5");
    expect(getSlotName("slot-5")).toBe("Свежий старт");
  });

  it("createSave keeps the default name when the prompt is cancelled", async () => {
    const { scene, saveGame } = makeScene({ withGame: true });
    vi.spyOn(window, "prompt").mockReturnValue(null);

    await scene.createSave("slot-6");

    expect(saveGame).toHaveBeenCalledWith("slot-6");
    expect(getSlotName("slot-6")).toBeNull();
  });

  it("loadSlot surfaces a not-found result without throwing", async () => {
    const { scene, loadGame } = makeScene();
    loadGame.mockResolvedValueOnce(false);
    await expect(scene.loadSlot("slot-1")).resolves.toBeUndefined();
    expect(loadGame).toHaveBeenCalledWith("slot-1");
  });

  it("swallows engine errors in load/save/delete (no throw to the caller)", async () => {
    const { scene, manager, saveGame, loadGame } = makeScene({
      withGame: true,
    });
    loadGame.mockRejectedValueOnce(new Error("load boom"));
    saveGame.mockRejectedValueOnce(new Error("save boom"));
    manager.deleteSlot.mockRejectedValueOnce(new Error("delete boom"));

    await expect(scene.loadSlot("slot-1")).resolves.toBeUndefined();
    await expect(scene.saveSlot("slot-1", "x")).resolves.toBeUndefined();
    await expect(scene.removeSlot("slot-1")).resolves.toBeUndefined();
  });
});
