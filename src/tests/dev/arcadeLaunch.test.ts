import { describe, it, expect, vi } from "vitest";
import {
  launchArcadeFromQuery,
  parseArcadeLaunch,
} from "@/systems/arcadeLaunch";
import { SceneType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";

function engineWith(player: { currentSystemId: string } | null) {
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  return {
    engine: { player, transitionTo } as unknown as GameEngine,
    transitionTo,
  };
}

describe("arcade direct launch", () => {
  it("only reacts to the arcade parameter", () => {
    expect(parseArcadeLaunch("")).toBeNull();
    expect(parseArcadeLaunch("?level=4")).toBeNull();
    expect(parseArcadeLaunch("?arcade")).toEqual({
      startLevel: 1,
      freshGame: false,
    });
  });

  it("reads and clamps the start level, from arcade= or level=", () => {
    expect(parseArcadeLaunch("?arcade=12")?.startLevel).toBe(12);
    expect(parseArcadeLaunch("?arcade=999")?.startLevel).toBe(50);
    expect(parseArcadeLaunch("?arcade=-3")?.startLevel).toBe(1);
    expect(parseArcadeLaunch("?arcade&level=7")?.startLevel).toBe(7);
    expect(parseArcadeLaunch("?arcade=abc")?.startLevel).toBe(1);
  });

  it("&game asks for a fresh game first", () => {
    expect(parseArcadeLaunch("?arcade=3&game")?.freshGame).toBe(true);
  });

  it("does nothing without the parameter", async () => {
    const { engine, transitionTo } = engineWith(null);
    expect(await launchArcadeFromQuery(engine, "?x=1")).toBe(false);
    expect(transitionTo).not.toHaveBeenCalled();
  });

  it("opens the arcade directly, never touching a game or save", async () => {
    const { engine, transitionTo } = engineWith(null);
    expect(await launchArcadeFromQuery(engine, "?arcade=5")).toBe(true);
    expect(transitionTo).toHaveBeenCalledTimes(1);
    expect(transitionTo.mock.calls[0][0]).toBe(SceneType.BLACK_HOLE_ARCADE);
    expect(transitionTo.mock.calls[0][1]).toMatchObject({ startLevel: 5 });
  });

  it("starts a new game first only when asked", async () => {
    const { engine, transitionTo } = engineWith({ currentSystemId: "s1" });
    await launchArcadeFromQuery(engine, "?arcade=2&game");
    expect(transitionTo.mock.calls.map((c) => c[0])).toEqual([
      SceneType.SPACE_FLIGHT,
      SceneType.BLACK_HOLE_ARCADE,
    ]);
    expect(transitionTo.mock.calls[1][1]).toMatchObject({
      returnSystemId: "s1",
      startLevel: 2,
    });
  });
});
