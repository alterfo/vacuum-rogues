import { describe, it, expect, vi } from "vitest";
import {
  drawShieldFlashes,
  SHIELD_FLASH_COLOR,
  type ShieldFlashSpec,
} from "@/presentation/flight/combatShieldFlash";

function fakeGraphics() {
  return {
    clear: vi.fn(),
    circle: vi.fn(),
    fill: vi.fn(),
  };
}

function flash(over: Partial<ShieldFlashSpec> = {}): ShieldFlashSpec {
  return { x: 10, y: 20, radius: 30, alpha: 0.4, ...over };
}

describe("drawShieldFlashes — shield-hit flash draw (Task 12)", () => {
  it("clears then draws a soft outer + brighter inner sphere per flash", () => {
    const g = fakeGraphics();
    drawShieldFlashes(g as never, [flash()]);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.circle).toHaveBeenCalledTimes(2);
    expect(g.fill).toHaveBeenCalledTimes(2);
    const alphas = g.fill.mock.calls.map((c) => c[0].alpha);
    expect(Math.max(...alphas)).toBeCloseTo(0.4);
    expect(Math.min(...alphas)).toBeLessThan(0.4);
  });

  it("defaults to the cold cyan shield tint when no colour is given", () => {
    const g = fakeGraphics();
    drawShieldFlashes(g as never, [flash()]);
    for (const call of g.fill.mock.calls) {
      expect(call[0].color).toBe(SHIELD_FLASH_COLOR);
    }
  });

  it("honours an explicit colour override", () => {
    const g = fakeGraphics();
    drawShieldFlashes(g as never, [flash({ color: 0xff0000 })]);
    for (const call of g.fill.mock.calls) {
      expect(call[0].color).toBe(0xff0000);
    }
  });

  it("skips a fully-faded (alpha ≤ 0) or zero-radius flash", () => {
    const g = fakeGraphics();
    drawShieldFlashes(g as never, [
      flash({ alpha: 0 }),
      flash({ radius: 0 }),
      flash({ alpha: 0.3 }),
    ]);
    expect(g.circle).toHaveBeenCalledTimes(2);
  });

  it("no-op-safe on an empty list (clears, draws nothing)", () => {
    const g = fakeGraphics();
    drawShieldFlashes(g as never, []);
    expect(g.clear).toHaveBeenCalledTimes(1);
    expect(g.circle).not.toHaveBeenCalled();
  });
});
