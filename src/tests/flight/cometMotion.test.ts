import { describe, it, expect } from "vitest";
import { Container } from "pixi.js";
import { AsteroidBelt } from "@/presentation/flight/AsteroidBelt";
import type { Renderer } from "@/presentation/Renderer";
import { buildCometFlyby, hyperbolaPoint } from "@/utils/flightGeometry";

/** Deterministic 0..1 generator (mulberry32) so a flyby is reproducible. */
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

/** Minimal Renderer stand-in backed by a real Container (no WebGL needed). */
function makeHarness(): { belt: AsteroidBelt; gameLayer: Container } {
  const gameLayer = new Container();
  const renderer = {
    app: { screen: { width: 800, height: 600 } },
    gameLayer,
  } as unknown as Renderer;
  return { belt: new AsteroidBelt(renderer, gameLayer), gameLayer };
}

/* Reach into the private field state for inspection — these are cosmetic
 * world-space motes with no public accessor, so a structural read is the only
 * way to assert their motion without standing up the whole flight scene. */
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
      // e > 1 is exactly what makes the path open (a closed orbit had e < 1).
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

    // Pin a deterministic flyby starting at the incoming edge so the whole pass
    // (entry → perihelion → exit) is observed regardless of the random spawn.
    const flyby = buildCometFlyby(cx, cy, R, seededRng(1));
    comet.flyby = flyby;
    comet.theta = flyby.thetaStart;
    comet.thetaSpeed = (flyby.thetaEnd - flyby.thetaStart) / 6000; // sweep ~6 s
    comet.cometCooldown = 0;
    comet.graphics.visible = true;

    const dists: number[] = [];
    // The entry point is the flyby's incoming edge crossing (true anomaly
    // thetaStart) — NOT comet.x/comet.y here, which still hold the random spawn
    // position until the first update() drives the body onto the flyby path.
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

    // It LEAVES — the comet exits the field instead of orbiting forever.
    expect(exited).toBe(true);
    expect(comet.cometCooldown).toBeGreaterThan(0);

    // A SINGLE perihelion: distance falls to one interior minimum then rises.
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
    // The closest approach matches the hyperbola's perihelion (inside the field).
    expect(minDist).toBeGreaterThanOrEqual(flyby.params.perihelion - 1);
    expect(minDist).toBeLessThan(flyby.params.perihelion + 5);
    expect(flyby.params.perihelion).toBeLessThan(R);

    // NOT periodic: the exit point is far from the entry point, not a return.
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

    // Force it just past the exit edge so the next tick parks it in cooldown.
    comet.theta = comet.flyby!.thetaEnd + 1;
    comet.cometCooldown = 0;
    comet.graphics.visible = true;
    belt.update(16, 0);
    expect(comet.graphics.visible).toBe(false);
    expect(comet.cometCooldown).toBeGreaterThan(0);

    // Fast-forward past the cooldown: a brand-new flyby flies in at the edge.
    belt.update(comet.cometCooldown + 1, 0);
    expect(comet.graphics.visible).toBe(true);
    expect(comet.flyby).not.toBeNull();
    expect(comet.theta).toBeCloseTo(comet.flyby!.thetaStart, 9);
    expect(Math.hypot(comet.x - cx, comet.y - cy)).toBeCloseTo(R, 0);

    belt.destroy();
  });

  it("leaves drifting asteroids on their unchanged straight-line path", () => {
    const { belt } = makeHarness();
    belt.initialize();
    const rock = peek(belt).asteroids.find((m) => !m.comet)!;
    const x0 = rock.x;
    const y0 = rock.y;
    const rot0 = rock.graphics.rotation;
    const dt = 10;
    belt.update(dt, 0);
    // Pure linear drift + constant spin — no orbital/hyperbolic terms applied.
    expect(rock.x).toBeCloseTo(x0 + rock.vx * dt, 9);
    expect(rock.y).toBeCloseTo(y0 + rock.vy * dt, 9);
    expect(rock.graphics.rotation).toBeCloseTo(rot0 + rock.spin * dt, 9);

    belt.destroy();
  });
});
