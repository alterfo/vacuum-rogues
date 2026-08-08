import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import type { Renderer } from "@/presentation/Renderer";
import { buildCometFlyby, hyperbolaPoint } from "@/utils/flightGeometry";

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeHarness(): { belt: AsteroidBelt; gameLayer: Container } {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;
  return { belt: new AsteroidBelt(renderer, gameLayer), gameLayer };
}

interface Mote {
  graphics: { x: number; y: number; rotation: number; visible: boolean };
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  comet: boolean;
  flyby: {
    params: { eccentricity: number };
    thetaStart: number;
    thetaEnd: number;
  } | null;
  theta: number;
  thetaSpeed: number;
  cometCooldown: number;
}
interface Internals {
  asteroids: Mote[];
  centerX: number;
  centerY: number;
  asteroidFieldRadius(): number;
}
const peek = (belt: AsteroidBelt) => belt as unknown as Internals;

describe("AsteroidBelt comet motion (hyperbolic flyby)", () => {
  it("spawns at least one comet whose trajectory is an open hyperbola (e > 1)", () => {
    const { belt } = makeHarness();
    belt.initialize();
    const comets = peek(belt).asteroids.filter((m) => m.comet);
    expect(comets.length).toBeGreaterThan(0);
    for (const c of comets) {
      expect(c.flyby).not.toBeNull();
      expect(c.flyby!.params.eccentricity).toBeGreaterThan(1);
    }
    belt.destroy();
  });

  it("sweeps a comet past the star once (single perihelion) and out of the field — never a loop", () => {
    const { belt } = makeHarness();
    belt.initialize();
    const inner = peek(belt);
    const cx = inner.centerX;
    const cy = inner.centerY;
    const R = inner.asteroidFieldRadius();
    const comet = inner.asteroids.find((m) => m.comet)!;

    const flyby = buildCometFlyby(cx, cy, R, seededRng(1));
    comet.flyby = flyby;
    comet.theta = flyby.thetaStart;
    comet.thetaSpeed = (flyby.thetaEnd - flyby.thetaStart) / 6000; // sweep ~6 s
    comet.cometCooldown = 0;
    comet.graphics.visible = true;

    const dists: number[] = [];
    const firstPos = hyperbolaPoint(flyby.params, flyby.thetaStart);
    let exited = false;
    let lastPos = { x: comet.x, y: comet.y };
    const dt = 50;
    for (let i = 0; i < 400; i++) {
      belt.update(dt, 0);
      if (!comet.graphics.visible) {
        exited = true;
        break;
      }
      lastPos = { x: comet.x, y: comet.y };
      dists.push(Math.hypot(comet.x - cx, comet.y - cy));
    }

    expect(exited).toBe(true);
    expect(comet.cometCooldown).toBeGreaterThan(0);

    const minDist = Math.min(...dists);
    const minIdx = dists.indexOf(minDist);
    expect(minIdx).toBeGreaterThan(0);
    expect(minIdx).toBeLessThan(dists.length - 1);
    for (let i = 1; i <= minIdx; i++) {
      expect(dists[i]).toBeLessThan(dists[i - 1] + 1e-6);
    }
    for (let i = minIdx + 1; i < dists.length; i++) {
      expect(dists[i]).toBeGreaterThan(dists[i - 1] - 1e-6);
    }
    expect(minDist).toBeGreaterThanOrEqual(flyby.params.perihelion - 1);
    expect(minDist).toBeLessThan(flyby.params.perihelion + 5);
    expect(flyby.params.perihelion).toBeLessThan(R);

    expect(
      Math.hypot(lastPos.x - firstPos.x, lastPos.y - firstPos.y),
    ).toBeGreaterThan(minDist);

    belt.destroy();
  });

  it("brings in a FRESH comet at the field edge after the cooldown elapses", () => {
    const { belt } = makeHarness();
    belt.initialize();
    const inner = peek(belt);
    const cx = inner.centerX;
    const cy = inner.centerY;
    const R = inner.asteroidFieldRadius();
    const comet = inner.asteroids.find((m) => m.comet)!;

    comet.theta = comet.flyby!.thetaEnd + 1;
    comet.cometCooldown = 0;
    comet.graphics.visible = true;
    belt.update(16, 0);
    expect(comet.graphics.visible).toBe(false);
    expect(comet.cometCooldown).toBeGreaterThan(0);

    belt.update(comet.cometCooldown + 1, 0);
    expect(comet.graphics.visible).toBe(true);
    expect(comet.flyby).not.toBeNull();
    expect(comet.theta).toBeCloseTo(comet.flyby!.thetaStart, 9);
    expect(Math.hypot(comet.x - cx, comet.y - cy)).toBeCloseTo(R, 0);

    belt.destroy();
  });
});
