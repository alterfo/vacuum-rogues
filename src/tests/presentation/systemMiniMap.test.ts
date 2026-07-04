import { describe, it, expect, vi } from "vitest";
import { Graphics } from "pixi.js";
import { SystemMiniMap } from "@/presentation/SystemMiniMap";

/**
 * Incoming-attacker threat marker (Task 5): an aggressive NPC dot on the
 * mini-map gets a distinct red ring so a closing hostile reads at a glance,
 * separate from its faction-colour dot.
 */
describe("SystemMiniMap incoming-attacker marker (Task 5)", () => {
  it("draws a red threat ring only around aggressive NPC dots", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const miniMap = new SystemMiniMap(800, 600);

    miniMap.updateWithSprites([], 0, 0, 0, 0, [
      { x: 10, y: 10, color: 0x00ff00, aggressive: false },
      { x: 20, y: 20, color: 0xff0000, aggressive: true },
    ]);

    const threatStrokes = strokeSpy.mock.calls.filter(
      ([opts]) => (opts as { color?: number }).color === 0xff3333,
    );
    expect(threatStrokes.length).toBe(1);

    strokeSpy.mockRestore();
    miniMap.destroy();
  });

  it("draws no threat ring when no NPC is aggressive", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const miniMap = new SystemMiniMap(800, 600);

    miniMap.updateWithSprites([], 0, 0, 0, 0, [
      { x: 10, y: 10, color: 0x00ff00, aggressive: false },
    ]);

    const threatStrokes = strokeSpy.mock.calls.filter(
      ([opts]) => (opts as { color?: number }).color === 0xff3333,
    );
    expect(threatStrokes.length).toBe(0);

    strokeSpy.mockRestore();
    miniMap.destroy();
  });

  it("treats a dot with no aggressive field as non-threatening", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const miniMap = new SystemMiniMap(800, 600);

    miniMap.updateWithSprites([], 0, 0, 0, 0, [
      { x: 10, y: 10, color: 0x00ff00 },
    ]);

    const threatStrokes = strokeSpy.mock.calls.filter(
      ([opts]) => (opts as { color?: number }).color === 0xff3333,
    );
    expect(threatStrokes.length).toBe(0);

    strokeSpy.mockRestore();
    miniMap.destroy();
  });
});
