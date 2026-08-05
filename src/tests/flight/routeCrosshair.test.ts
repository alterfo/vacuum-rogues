import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { PlayerShipRenderer } from "@/presentation/flight/PlayerShipRenderer";
import { ShipPhysics } from "@/systems/ShipPhysics";
import type { Renderer } from "@/presentation/Renderer";

function makeRenderer(gameLayer: Container): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer: new Container(),
    gameLayer,
  } as unknown as Renderer;
}

function crosshairVisible(module: PlayerShipRenderer): boolean {
  const ind = (module as unknown as { targetIndicator: { visible: boolean } })
    .targetIndicator;
  return ind.visible;
}

describe("ShipPhysics.isFollowingRoute (route-active signal)", () => {
  it("is false on spawn", () => {
    const p = new ShipPhysics(0, 0, 0.1);
    expect(p.isFollowingRoute()).toBe(false);
  });

  it("setPath marks the ship as following a route", () => {
    const p = new ShipPhysics(0, 0, 0.1);
    p.setPath([
      { x: 100, y: 0 },
      { x: 500, y: 0 },
    ]);
    expect(p.isFollowingRoute()).toBe(true);
  });

  it("stays true on the FINAL leg, after the queue empties (unlike hasPath)", () => {
    const p = new ShipPhysics(0, 0, 0.5);
    p.setPath([
      { x: 60, y: 0 },
      { x: 1000, y: 0 },
    ]);
    for (let i = 0; i < 5; i++) p.update(50);
    expect(p.hasPath()).toBe(false); // queue drained → final leg
    expect(p.isMoving).toBe(true);
    expect(p.isFollowingRoute()).toBe(true); // route still active
  });

  it("clears on arrival at the destination", () => {
    const p = new ShipPhysics(0, 0, 1.0);
    p.setPath([{ x: 100, y: 0 }]);
    for (let i = 0; i < 500; i++) p.update(100);
    expect(p.isMoving).toBe(false);
    expect(p.isFollowingRoute()).toBe(false);
  });

  it("setTarget (bare point-move) is NOT a route", () => {
    const p = new ShipPhysics(0, 0, 0.1);
    p.setPath([{ x: 500, y: 0 }]); // first on a route
    p.setTarget(800, 0); // then a bare point-move overrides it
    expect(p.isMoving).toBe(true);
    expect(p.isFollowingRoute()).toBe(false);
  });

  it("stop() and teleport() both clear the route flag", () => {
    const p = new ShipPhysics(0, 0, 0.5);
    p.setPath([{ x: 500, y: 0 }]);
    p.stop();
    expect(p.isFollowingRoute()).toBe(false);

    p.setPath([{ x: 500, y: 0 }]);
    p.teleport(10, 10);
    expect(p.isFollowingRoute()).toBe(false);
  });
});

describe("PlayerShipRenderer crosshair: hidden on route flight, shown for point-move", () => {
  function make(physics: ShipPhysics): {
    module: PlayerShipRenderer;
    gameLayer: Container;
  } {
    const gameLayer = new Container();
    const module = new PlayerShipRenderer(
      makeRenderer(gameLayer),
      gameLayer,
      physics,
    );
    module.initialize();
    return { module, gameLayer };
  }

  it("hides the crosshair while auto-flying a route (even far from target)", () => {
    const physics = new ShipPhysics(100, 200, 0.1);
    physics.setPath([{ x: 900, y: 200 }]); // far destination, isMoving + route
    const { module } = make(physics);

    module.update(16, 0);

    expect(physics.getDistanceToTarget()).toBeGreaterThan(20);
    expect(physics.isFollowingRoute()).toBe(true);
    expect(crosshairVisible(module)).toBe(false);

    module.destroy();
  });

  it("shows the crosshair for a bare point-move that is far enough", () => {
    const physics = new ShipPhysics(100, 200, 0.1);
    physics.setTarget(900, 200); // far destination, isMoving, NOT a route
    const { module } = make(physics);

    module.update(16, 0);

    expect(physics.getDistanceToTarget()).toBeGreaterThan(20);
    expect(physics.isFollowingRoute()).toBe(false);
    expect(crosshairVisible(module)).toBe(true);

    module.destroy();
  });

  it("keeps the crosshair hidden when the ship is parked", () => {
    const physics = new ShipPhysics(100, 200, 0.1);
    const { module } = make(physics); // not moving

    module.update(16, 0);

    expect(crosshairVisible(module)).toBe(false);

    module.destroy();
  });
});
