import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { applyReducedMotion } from "@/presentation/ui/reducedMotion";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENE_SOURCE = resolve(
  HERE,
  "../../presentation/BlackHoleArcadeScene.ts",
);

describe("applyReducedMotion", () => {
  it("applies the setting to every target when enabled", () => {
    const background = { setReducedMotion: vi.fn() };
    const fx = { setReducedMotion: vi.fn() };
    applyReducedMotion(true, [background, fx, null]);
    expect(background.setReducedMotion).toHaveBeenCalledWith(true);
    expect(fx.setReducedMotion).toHaveBeenCalledWith(true);
  });

  it("leaves targets untouched when disabled", () => {
    const background = { setReducedMotion: vi.fn() };
    applyReducedMotion(false, [background]);
    expect(background.setReducedMotion).not.toHaveBeenCalled();
  });

  it("is wired into the arcade scene", () => {
    const source = readFileSync(SCENE_SOURCE, "utf8");
    expect(source).toContain(
      "applyReducedMotion(this.reducedMotionEnabled, [this.background, this.fx])",
    );
  });
});
