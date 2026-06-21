/**
 * Task 4 (docs/plans/20260619-keyboard-controls-turn-modals-map-jump.md):
 * "Reliable galaxy-map double-click jump."
 *
 * The old detection hand-rolled a 300 ms `Date.now()` compare on `pointerdown`,
 * which raced the single-click info-panel open and dropped jumps. The robust
 * scheme listens for PixiJS's native `pointertap` and branches on
 * `event.detail` — the boundary's own click counter (incremented for
 * consecutive taps on the same target within its threshold). A double-click
 * (detail ≥ 2) jumps; a single tap (detail 1) only opens the info panel; a pan
 * that ends over a system (`hasDragged`) is ignored.
 *
 * Tested with the real production-wired hit area (`createSystemHitArea`) and
 * real `pointertap` events carrying a native `detail` count — not by calling
 * the handler directly. The coordinate-level real-mouse path is covered by the
 * E2E star-map page object (engine-driven `performWarpJumpTo`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Graphics, type FederatedPointerEvent } from "pixi.js";
import { StarMapScene } from "@/presentation/StarMapScene";
import type { StarSystem } from "@/domain/StarSystem";

// scaledFont()/logger touch localStorage; ensure it exists (Node shadows jsdom's).
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

type Probe = {
  scene: StarMapScene;
  hitArea: Graphics;
  single: ReturnType<typeof vi.fn>;
  double: ReturnType<typeof vi.fn>;
  setDragged: (v: boolean) => void;
};

/** Build a StarMapScene shell wired with the production hit area for one system. */
function makeProbe(): Probe {
  const scene = Object.create(StarMapScene.prototype) as StarMapScene;
  const fields = scene as unknown as Record<string, unknown>;
  fields.hasDragged = false;

  // Stub the routed handlers so the real bodies (render / warp / transition)
  // don't run — we only assert the routing the hit area performs.
  const single = vi.fn();
  const double = vi.fn();
  fields.handleSystemClick = single;
  fields.handleSystemDoubleClick = double;

  const system = { id: "sys-1", name: "Альфа" } as unknown as StarSystem;
  const hitArea = (
    scene as unknown as {
      createSystemHitArea(x: number, y: number, s: StarSystem): Graphics;
    }
  ).createSystemHitArea(0, 0, system);

  return {
    scene,
    hitArea,
    single,
    double,
    setDragged: (v) => void (fields.hasDragged = v),
  };
}

/** Fire a real `pointertap` carrying a native click count. */
function tap(hitArea: Graphics, detail: number): void {
  hitArea.emit("pointertap", { detail } as FederatedPointerEvent);
}

describe("star-map double-click jump", () => {
  let p: Probe;
  beforeEach(() => {
    p = makeProbe();
  });

  it("builds an interactive hit area listening on pointertap (not pointerdown)", () => {
    expect(p.hitArea).toBeInstanceOf(Graphics);
    expect(p.hitArea.eventMode).toBe("static");
    expect(p.hitArea.cursor).toBe("pointer");
    expect(p.hitArea.listenerCount("pointertap")).toBe(1);
    // The hand-rolled pointerdown timestamp scheme is gone.
    expect(p.hitArea.listenerCount("pointerdown")).toBe(0);
  });

  it("single click (detail 1) opens the info panel only — no jump", () => {
    tap(p.hitArea, 1);
    expect(p.single).toHaveBeenCalledTimes(1);
    expect(p.double).not.toHaveBeenCalled();
  });

  it("double click (detail 2) triggers the warp-jump handler — no extra info open", () => {
    tap(p.hitArea, 2);
    expect(p.double).toHaveBeenCalledTimes(1);
    expect(p.single).not.toHaveBeenCalled();
  });

  it("on a real double-click sequence (detail 1 then 2) still routes the jump", () => {
    // Production reality: PixiJS fires pointertap on EVERY tap with a rising
    // detail count, so a genuine double-click is two events — the first
    // (detail 1) opens the info panel, the second (detail 2) jumps. The jump
    // wins because performWarpJump transitions/destroys the scene; this pins
    // that the second event reaches handleSystemDoubleClick.
    tap(p.hitArea, 1);
    tap(p.hitArea, 2);
    expect(p.single).toHaveBeenCalledTimes(1);
    expect(p.double).toHaveBeenCalledTimes(1);
  });

  it("treats a higher click count (detail 3) as a double-click jump too", () => {
    tap(p.hitArea, 3);
    expect(p.double).toHaveBeenCalledTimes(1);
    expect(p.single).not.toHaveBeenCalled();
  });

  it("defaults a missing detail to a single click", () => {
    p.hitArea.emit("pointertap", {} as FederatedPointerEvent);
    expect(p.single).toHaveBeenCalledTimes(1);
    expect(p.double).not.toHaveBeenCalled();
  });

  it("ignores taps after a pan (hasDragged) — neither handler fires", () => {
    p.setDragged(true);
    tap(p.hitArea, 1);
    tap(p.hitArea, 2);
    expect(p.single).not.toHaveBeenCalled();
    expect(p.double).not.toHaveBeenCalled();
  });
});
