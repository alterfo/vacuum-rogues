import { describe, it, expect } from "vitest";
import {
  layoutFor,
  touchHitArea,
  liveViewport,
  PHONE_MAX_SHORT_SIDE_PX,
  TABLET_MAX_SHORT_SIDE_PX,
  MIN_TOUCH_TARGET_PX,
  UI_SCALE,
  type LayoutMode,
  type Viewport,
} from "@/presentation/ui/responsiveLayout";
import type { DeviceEnv } from "@/systems/device/isMobileDevice";

/** A DeviceEnv whose matchMedia answers `(pointer: coarse)` per `coarse`. */
function env(opts: { coarse?: boolean; w?: number; h?: number }): DeviceEnv {
  return {
    matchMedia: (q: string) => ({
      matches: q.includes("coarse") ? !!opts.coarse : false,
    }),
    innerWidth: opts.w,
    innerHeight: opts.h,
  };
}

describe("layoutFor — viewport → layout mode", () => {
  it("classifies a phone (short side < 768) in portrait and landscape", () => {
    expect(layoutFor({ width: 390, height: 844 }).mode).toBe("phone");
    // landscape: width is the short side
    expect(layoutFor({ width: 844, height: 390 }).mode).toBe("phone");
  });

  it("classifies a tablet (768 ≤ short side < 1024), e.g. iPad portrait/landscape", () => {
    expect(layoutFor({ width: 768, height: 1024 }).mode).toBe("tablet");
    expect(layoutFor({ width: 1024, height: 768 }).mode).toBe("tablet");
    expect(layoutFor({ width: 800, height: 1280 }).mode).toBe("tablet");
  });

  it("classifies desktop (short side ≥ 1024)", () => {
    expect(layoutFor({ width: 1920, height: 1080 }).mode).toBe("desktop");
    expect(layoutFor({ width: 1280, height: 1024 }).mode).toBe("desktop");
  });

  it("treats the phone/tablet boundary as exclusive at 768", () => {
    expect(
      layoutFor({ width: 1200, height: PHONE_MAX_SHORT_SIDE_PX - 1 }).mode,
    ).toBe("phone");
    expect(
      layoutFor({ width: 1200, height: PHONE_MAX_SHORT_SIDE_PX }).mode,
    ).toBe("tablet");
  });

  it("treats the tablet/desktop boundary as exclusive at 1024", () => {
    expect(
      layoutFor({ width: 2000, height: TABLET_MAX_SHORT_SIDE_PX - 1 }).mode,
    ).toBe("tablet");
    expect(
      layoutFor({ width: 2000, height: TABLET_MAX_SHORT_SIDE_PX }).mode,
    ).toBe("desktop");
  });

  it("reports per-mode uiScale and a touch flag", () => {
    const cases: Array<[Viewport, LayoutMode]> = [
      [{ width: 390, height: 844 }, "phone"],
      [{ width: 768, height: 1024 }, "tablet"],
      [{ width: 1920, height: 1080 }, "desktop"],
    ];
    for (const [vp, mode] of cases) {
      const l = layoutFor(vp);
      expect(l.uiScale).toBe(UI_SCALE[mode]);
      expect(l.touch).toBe(mode !== "desktop");
    }
  });

  it("sets minTarget to the touch min on touch layouts and 0 on desktop", () => {
    expect(layoutFor({ width: 390, height: 844 }).minTarget).toBe(
      MIN_TOUCH_TARGET_PX,
    );
    expect(layoutFor({ width: 768, height: 1024 }).minTarget).toBe(
      MIN_TOUCH_TARGET_PX,
    );
    expect(layoutFor({ width: 1920, height: 1080 }).minTarget).toBe(0);
  });

  it("degrades a zero/unknown viewport to the safe desktop profile", () => {
    expect(layoutFor({ width: 0, height: 0 }).mode).toBe("desktop");
    expect(layoutFor({ width: 390, height: 0 }).mode).toBe("desktop");
    expect(layoutFor({ width: 0, height: 844 }).mode).toBe("desktop");
  });
});

describe("touchHitArea — gated touch-target expansion", () => {
  it("returns the exact element bounds on a fine-pointer desktop (unchanged)", () => {
    const ha = touchHitArea(160, 32, env({ coarse: false, w: 1920, h: 1080 }));
    expect(ha).toEqual({ x: 0, y: 0, width: 160, height: 32 });
  });

  it("returns the exact bounds on a narrow DESKTOP window (no coarse pointer)", () => {
    // A small resized desktop browser is a touch *layout* by viewport but not a
    // touch *device* — must NOT get fat targets (desktop stays byte-for-byte).
    const ha = touchHitArea(160, 32, env({ coarse: false, w: 600, h: 700 }));
    expect(ha).toEqual({ x: 0, y: 0, width: 160, height: 32 });
  });

  it("grows a small button to the min target, re-centred, on a coarse-pointer phone", () => {
    const ha = touchHitArea(32, 32, env({ coarse: true, w: 390, h: 844 }));
    expect(ha.width).toBe(MIN_TOUCH_TARGET_PX);
    expect(ha.height).toBe(MIN_TOUCH_TARGET_PX);
    // re-centred: padding split evenly above/left of the visual element
    expect(ha.x).toBe((32 - MIN_TOUCH_TARGET_PX) / 2);
    expect(ha.y).toBe((32 - MIN_TOUCH_TARGET_PX) / 2);
  });

  it("only grows the under-sized axis; a wide button keeps its width", () => {
    const ha = touchHitArea(160, 28, env({ coarse: true, w: 390, h: 844 }));
    expect(ha.width).toBe(160); // already ≥ minTarget
    expect(ha.x).toBe(0);
    expect(ha.height).toBe(MIN_TOUCH_TARGET_PX);
    expect(ha.y).toBe((28 - MIN_TOUCH_TARGET_PX) / 2);
  });

  it("expands on a coarse-pointer tablet too", () => {
    const ha = touchHitArea(40, 40, env({ coarse: true, w: 768, h: 1024 }));
    expect(ha.width).toBe(MIN_TOUCH_TARGET_PX);
    expect(ha.height).toBe(MIN_TOUCH_TARGET_PX);
  });
});

describe("liveViewport", () => {
  it("reads innerWidth/innerHeight from the env, degrading to 0", () => {
    expect(liveViewport(env({ w: 390, h: 844 }))).toEqual({
      width: 390,
      height: 844,
    });
    expect(liveViewport({})).toEqual({ width: 0, height: 0 });
  });
});
