import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Graphics, type FederatedPointerEvent } from "pixi.js";
import { StarMapScene } from "@/presentation/StarMapScene";
import type { StarSystem } from "@/domain/StarSystem";

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
  hitAreaFor: (system: StarSystem) => Graphics;
};

const SYS_1 = { id: "sys-1", name: "Альфа" } as unknown as StarSystem;
const SYS_2 = { id: "sys-2", name: "Бета" } as unknown as StarSystem;

function makeProbe(): Probe {
  const scene = Object.create(StarMapScene.prototype) as StarMapScene;
  const fields = scene as unknown as Record<string, unknown>;
  fields.hasDragged = false;
  fields.DOUBLE_CLICK_MS = 350;
  fields.lastTapSystemId = null;
  fields.lastTapAt = 0;

  const single = vi.fn();
  const double = vi.fn();
  fields.handleSystemClick = single;
  fields.handleSystemDoubleClick = double;

  const hitAreaFor = (system: StarSystem): Graphics =>
    (
      scene as unknown as {
        createSystemHitArea(x: number, y: number, s: StarSystem): Graphics;
      }
    ).createSystemHitArea(0, 0, system);

  return {
    scene,
    hitArea: hitAreaFor(SYS_1),
    single,
    double,
    setDragged: (v) => void (fields.hasDragged = v),
    hitAreaFor,
  };
}

function tap(hitArea: Graphics): void {
  hitArea.emit("pointertap", {} as FederatedPointerEvent);
}

describe("star-map double-click jump", () => {
  let p: Probe;
  let nowMs: number;

  beforeEach(() => {
    nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    p = makeProbe();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds an interactive hit area listening on pointertap (not pointerdown)", () => {
    expect(p.hitArea).toBeInstanceOf(Graphics);
    expect(p.hitArea.eventMode).toBe("static");
    expect(p.hitArea.cursor).toBe("pointer");
    expect(p.hitArea.listenerCount("pointertap")).toBe(1);
    expect(p.hitArea.listenerCount("pointerdown")).toBe(0);
  });

  it("a single tap opens the info panel only — no jump", () => {
    tap(p.hitArea);
    expect(p.single).toHaveBeenCalledTimes(1);
    expect(p.double).not.toHaveBeenCalled();
  });

  it("two quick taps on the same system → first opens info, second jumps", () => {
    tap(p.hitArea);
    nowMs += 100; // within the 350 ms window
    tap(p.hitArea);
    expect(p.single).toHaveBeenCalledTimes(1);
    expect(p.double).toHaveBeenCalledTimes(1);
  });

  it("REGRESSION: jump survives the renderStarMap hit-area rebuild (second tap on a fresh object)", () => {
    tap(p.hitArea);
    nowMs += 100;
    const rebuilt = p.hitAreaFor(SYS_1); // simulate the destroy/recreate
    tap(rebuilt);
    expect(p.single).toHaveBeenCalledTimes(1);
    expect(p.double).toHaveBeenCalledTimes(1);
  });

  it("two taps separated beyond the window are both single clicks (no jump)", () => {
    tap(p.hitArea);
    nowMs += 400; // > 350 ms
    tap(p.hitArea);
    expect(p.single).toHaveBeenCalledTimes(2);
    expect(p.double).not.toHaveBeenCalled();
  });

  it("quick taps on two different systems are both single clicks (no jump)", () => {
    const other = p.hitAreaFor(SYS_2);
    tap(p.hitArea);
    nowMs += 50;
    tap(other);
    expect(p.single).toHaveBeenCalledTimes(2);
    expect(p.double).not.toHaveBeenCalled();
  });

  it("a third quick tap after a double does not re-trigger the jump", () => {
    tap(p.hitArea); // single
    nowMs += 50;
    tap(p.hitArea); // double → consumes the pair
    nowMs += 50;
    tap(p.hitArea); // treated as a fresh single
    expect(p.double).toHaveBeenCalledTimes(1);
    expect(p.single).toHaveBeenCalledTimes(2);
  });

  it("ignores taps after a pan (hasDragged) — neither handler fires", () => {
    p.setDragged(true);
    tap(p.hitArea);
    nowMs += 50;
    tap(p.hitArea);
    expect(p.single).not.toHaveBeenCalled();
    expect(p.double).not.toHaveBeenCalled();
  });
});
