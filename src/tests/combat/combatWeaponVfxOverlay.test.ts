import { describe, it, expect, vi } from "vitest";
import {
  WeaponVfxKind,
  type WeaponVfxVariant,
} from "@/presentation/flight/combatWeaponVfx";
import {
  DISTORTION_COLOR,
  MISSILE_TRAIL_COLOR,
  WEAPON_VFX_COLOR,
  drawWeaponVfx,
  type WeaponVfxSpec,
} from "@/presentation/flight/combatWeaponVfxOverlay";

// Minimal fake Graphics recorder — the seam only touches these methods.
function fakeGraphics() {
  return {
    clear: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    circle: vi.fn(),
    fill: vi.fn(),
  };
}

function variant(over: Partial<WeaponVfxVariant> = {}): WeaponVfxVariant {
  return { kind: WeaponVfxKind.BEAM, distortion: false, ...over };
}

function shot(over: Partial<WeaponVfxSpec> = {}): WeaponVfxSpec {
  return {
    variant: variant(),
    from: { x: 0, y: 0 },
    to: { x: 100, y: 0 },
    ...over,
  };
}

describe("drawWeaponVfx — weapon-type visual dispatch (Task 13)", () => {
  it("BEAM draws one continuous line shooter→target", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, [
      shot({ variant: variant({ kind: WeaponVfxKind.BEAM }) }),
    ]);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.moveTo).toHaveBeenCalledWith(0, 0);
    expect(g.lineTo).toHaveBeenCalledWith(100, 0);
    expect(g.stroke).toHaveBeenCalledTimes(1);
    expect(g.stroke.mock.calls[0][0].color).toBe(WEAPON_VFX_COLOR);
    // A beam is a pure stroke — no spark fill.
    expect(g.fill).not.toHaveBeenCalled();
  });

  it("BURST draws a short bolt plus an impact spark fill", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, [
      shot({ variant: variant({ kind: WeaponVfxKind.BURST }) }),
    ]);
    expect(g.stroke).toHaveBeenCalledTimes(1);
    expect(g.circle).toHaveBeenCalledTimes(1);
    expect(g.fill).toHaveBeenCalledTimes(1); // spark, distinct from a plain beam
  });

  it("MISSILE_TRAIL draws a polyline along the flown trail points", () => {
    const g = fakeGraphics();
    const trail = [
      { x: 0, y: 0 },
      { x: 10, y: 2 },
      { x: 20, y: 6 },
    ];
    drawWeaponVfx(g as never, [
      shot({ variant: variant({ kind: WeaponVfxKind.MISSILE_TRAIL }), trail }),
    ]);
    // One moveTo to the first trail point, then a lineTo per remaining point.
    expect(g.moveTo).toHaveBeenCalledWith(0, 0);
    expect(g.lineTo).toHaveBeenCalledTimes(2);
    expect(g.lineTo).toHaveBeenCalledWith(20, 6);
    expect(g.stroke.mock.calls[0][0].color).toBe(MISSILE_TRAIL_COLOR);
  });

  it("MISSILE_TRAIL falls back to a from→to line without a usable trail", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, [
      shot({ variant: variant({ kind: WeaponVfxKind.MISSILE_TRAIL }) }),
    ]);
    expect(g.moveTo).toHaveBeenCalledWith(0, 0);
    expect(g.lineTo).toHaveBeenCalledWith(100, 0);
    expect(g.stroke).toHaveBeenCalledTimes(1);
  });

  it("a distortion-tier shot adds a ripple ring over the base kind", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, [
      shot({
        variant: variant({ kind: WeaponVfxKind.BEAM, distortion: true }),
      }),
    ]);
    // Base beam stroke + the distortion ripple stroke.
    expect(g.stroke).toHaveBeenCalledTimes(2);
    const distortionCall = g.stroke.mock.calls.find(
      (c) => c[0].color === DISTORTION_COLOR,
    );
    expect(distortionCall).toBeTruthy();
    expect(g.circle).toHaveBeenCalledTimes(1); // the ripple ring
  });

  it("honours an explicit base colour override (distortion keeps its own tint)", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, [
      shot({ variant: variant({ distortion: true }), color: 0xff0000 }),
    ]);
    const colors = g.stroke.mock.calls.map((c) => c[0].color);
    expect(colors).toContain(0xff0000);
    expect(colors).toContain(DISTORTION_COLOR);
  });

  it("skips a fully-faded (alpha ≤ 0) shot", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, [shot({ alpha: 0 })]);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.stroke).not.toHaveBeenCalled();
  });

  it("no-op-safe on an empty list (clears, draws nothing)", () => {
    const g = fakeGraphics();
    drawWeaponVfx(g as never, []);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.stroke).not.toHaveBeenCalled();
  });
});
