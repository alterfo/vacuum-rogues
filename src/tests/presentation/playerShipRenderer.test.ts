import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import type { Renderer } from "@/presentation/Renderer";
import { ShipPhysics } from "@/systems/ShipPhysics";

function makeHarness(
  initialX = 100,
  initialY = 200,
): {
  ship: PlayerShipRenderer;
  gameLayer: Container;
  physics: ShipPhysics;
} {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;

  const physics = new ShipPhysics(initialX, initialY, 0.1);
  const ship = new PlayerShipRenderer(renderer, gameLayer, physics);
  return { ship, gameLayer, physics };
}

describe("PlayerShipRenderer (extracted FlightModule)", () => {
  it("mounts the ship container + target indicator on initialize()", () => {
    const { ship, gameLayer } = makeHarness();

    expect(ship.container).toBeNull();
    expect(gameLayer.children.length).toBe(0);

    ship.initialize();

    expect(gameLayer.children.length).toBe(2);
    const container = ship.container;
    expect(container).not.toBeNull();
    expect(container!.children.length).toBeGreaterThan(0); // glow + hull graphics
    expect(container!.x).toBe(100);
    expect(container!.y).toBe(200);

    ship.destroy();
  });

  it("syncs the container to the physics position on update()", () => {
    const { ship, physics } = makeHarness();
    ship.initialize();

    physics.teleport(640, 480);
    physics.shipAngle = 1.23;
    ship.update(1 / 60, 100);

    expect(ship.container!.x).toBe(640);
    expect(ship.container!.y).toBe(480);
    expect(ship.container!.rotation).toBeCloseTo(1.23);
  });

  it("walks the take-off arc while active, then parks at its end", () => {
    const { ship, physics } = makeHarness(0, 0);
    ship.initialize();

    expect(ship.isArcActive()).toBe(false);

    const arc = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    physics.teleport(10, 0);
    ship.startTakeoffArc(arc);

    expect(ship.isArcActive()).toBe(true);
    expect(ship.container!.x).toBe(0);

    ship.update(1000, 100);
    expect(ship.isArcActive()).toBe(false);
    expect(ship.container!.x).toBe(10);
    expect(ship.container!.y).toBe(0);
  });

  it("cancels an in-progress arc via finishTakeoff()", () => {
    const { ship, physics } = makeHarness(0, 0);
    ship.initialize();
    physics.teleport(50, 0);
    ship.startTakeoffArc([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(ship.isArcActive()).toBe(true);

    ship.finishTakeoff();
    expect(ship.isArcActive()).toBe(false);
    expect(() => ship.finishTakeoff()).not.toThrow();
  });

  it("runs an update tick and tears down cleanly without leaking children", () => {
    const { ship, gameLayer } = makeHarness();
    ship.initialize();

    expect(() => ship.update(1 / 60, 100)).not.toThrow();
    expect(() => ship.destroy()).not.toThrow();

    expect(gameLayer.children.length).toBe(0);
    expect(ship.container).toBeNull();
  });
});
