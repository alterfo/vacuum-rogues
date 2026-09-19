import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import {
  BlackHoleRenderer,
  blackHolePosition,
} from "@/presentation/flight/BlackHoleRenderer";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { SYSTEM_GEOMETRY } from "@/config/balance";

function makeHarness(gameEngine: GameEngine | null = null): {
  blackHole: BlackHoleRenderer;
  gameLayer: Container;
} {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer,
  } as unknown as Renderer;
  const blackHole = new BlackHoleRenderer(renderer, gameEngine, gameLayer);
  return { blackHole, gameLayer };
}

function engineFor(systemId: string): GameEngine {
  return {
    player: { currentSystemId: systemId },
    galaxy: {
      systems: [{ id: systemId, hasBlackHoleAnomaly: true }],
    },
  } as unknown as GameEngine;
}

describe("blackHolePosition", () => {
  it("is deterministic for the same systemId", () => {
    expect(blackHolePosition("sys-A")).toEqual(blackHolePosition("sys-A"));
  });

  it("lands within the planet orbit radius band for many systems", () => {
    for (let i = 0; i < 200; i++) {
      const pos = blackHolePosition(`sys-${i}`);
      const distance = Math.hypot(pos.x, pos.y);
      expect(distance).toBeGreaterThanOrEqual(SYSTEM_GEOMETRY.innerRadius);
      expect(distance).toBeLessThanOrEqual(SYSTEM_GEOMETRY.outerRadius);
    }
  });
});

describe("BlackHoleRenderer contact detection", () => {
  it("triggers once when entering the event horizon, not every frame", () => {
    const { blackHole } = makeHarness(engineFor("sys-a"));

    expect(
      blackHole.updateBlackHoleContact(
        blackHole.x + blackHole.eventHorizonRadius + 50,
        blackHole.y,
      ),
    ).toBe(false);

    expect(blackHole.updateBlackHoleContact(blackHole.x, blackHole.y)).toBe(
      true,
    );

    expect(blackHole.updateBlackHoleContact(blackHole.x, blackHole.y)).toBe(
      false,
    );
  });

  it("re-triggers only after leaving and re-entering the event horizon", () => {
    const { blackHole } = makeHarness(engineFor("sys-b"));

    expect(blackHole.updateBlackHoleContact(blackHole.x, blackHole.y)).toBe(
      true,
    );

    expect(
      blackHole.updateBlackHoleContact(
        blackHole.x + blackHole.eventHorizonRadius + 1,
        blackHole.y,
      ),
    ).toBe(false);

    expect(blackHole.updateBlackHoleContact(blackHole.x, blackHole.y)).toBe(
      true,
    );
  });
});

describe("BlackHoleRenderer (extracted FlightModule)", () => {
  it("mounts into the game layer and tears down without leaking children", () => {
    const { blackHole, gameLayer } = makeHarness(engineFor("sys-c"));

    expect(gameLayer.children.length).toBe(0);

    blackHole.initialize();
    expect(gameLayer.children.length).toBeGreaterThan(0);

    expect(() => blackHole.update(16, 100)).not.toThrow();
    blackHole.destroy();

    expect(gameLayer.children.length).toBe(0);
  });
});
