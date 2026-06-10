import { describe, it, expect } from "vitest";
import { UiButton } from "@/presentation/ui/UiButton";
import { Rectangle } from "pixi.js";

/**
 * Real-pointer regression (2026-06-10 playtest): every UiButton child has
 * eventMode='none' (labels must not swallow clicks — CLAUDE.md Rule 3), which
 * in PixiJS 8 leaves the parent Container with NO hit-test geometry: the event
 * boundary prunes 'none' children and a bare Container contributes no bounds.
 * Without an explicit hitArea the button is mouse-dead even though direct
 * handler calls (e2e* methods) work — Ход/пауза, speed, gear and all
 * planet-menu buttons were unclickable with a real mouse.
 *
 * The E2E half of this regression lives in playtest-regression.spec.ts
 * ("HUD buttons respond to REAL mouse clicks").
 */
describe("UiButton hit geometry", () => {
  it("sets an explicit hitArea matching the button rect", () => {
    const btn = new UiButton("▶", "Ход", "primary", () => {}, 120, 40);
    const hit = btn.container.hitArea as Rectangle;

    expect(hit).toBeInstanceOf(Rectangle);
    expect(hit.x).toBe(0);
    expect(hit.y).toBe(0);
    expect(hit.width).toBe(120);
    expect(hit.height).toBe(40);
  });

  it("keeps the container interactive and all children non-interactive", () => {
    const btn = new UiButton("", "Метка", "neutral", () => {});

    expect(btn.container.eventMode).toBe("static");
    expect(btn.container.cursor).toBe("pointer");
    for (const child of btn.container.children) {
      expect(child.eventMode).toBe("none");
    }
  });
});
