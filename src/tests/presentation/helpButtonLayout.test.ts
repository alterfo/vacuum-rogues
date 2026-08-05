import { describe, it, expect, vi } from "vitest";

vi.mock("pixi.js", () => ({
  Container: vi.fn(),
  Graphics: vi.fn(),
  Text: vi.fn(),
  Sprite: vi.fn(),
  Rectangle: vi.fn(),
}));

import { helpButtonRect } from "@/presentation/ui/mountSceneHelp";
import { creditsHudAnchor } from "@/presentation/PlanetScene";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

describe("planet-screen «?» help button vs credit-balance read-out layout", () => {
  const widths = [800, 1024, 1280, 1366, 1920];
  const textWidths = [40, 80, 120, 160, 200, 260];
  const fontHeights = [16, 18, 20, 24];

  for (const w of widths) {
    it(`«?» button never covers the balance read-out at screen width ${w}`, () => {
      const help = helpButtonRect(w);
      const anchor = creditsHudAnchor(w);
      for (const tw of textWidths) {
        for (const fh of fontHeights) {
          const credits: Rect = {
            x: anchor.x - tw, // right-anchored: right edge at anchor.x
            y: anchor.y,
            w: tw,
            h: fh,
          };
          expect(
            rectsIntersect(help, credits),
            `overlap at w=${w}, textWidth=${tw}, fontHeight=${fh}`,
          ).toBe(false);
        }
      }
    });
  }

  it("the «?» button reserved rect matches its documented top-right geometry", () => {
    const help = helpButtonRect(1280);
    expect(help).toEqual({ x: 1280 - 34 - 12, y: 12, w: 34, h: 34 });
  });
});
