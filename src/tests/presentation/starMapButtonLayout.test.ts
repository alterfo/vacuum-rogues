import { describe, it, expect } from "vitest";

import { helpButtonRect } from "@/presentation/ui/mountSceneHelp";
import {
  starMapButtonRect,
  STAR_MAP_BUTTON_SIZE,
  STAR_MAP_BUTTON_GAP,
} from "@/presentation/flight/starMapButton";

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

describe("flight-HUD star-map icon button vs the «?» help corner (Bug 1)", () => {
  const widths = [320, 800, 1024, 1280, 1366, 1920];

  for (const w of widths) {
    it(`never overlaps helpButtonRect at screen width ${w}`, () => {
      const starMap = starMapButtonRect(w);
      const help = helpButtonRect(w);
      expect(rectsIntersect(starMap, help), `overlap at w=${w}`).toBe(false);
    });
  }

  it("sits immediately left of the help corner with a fixed gap", () => {
    const w = 1280;
    const starMap = starMapButtonRect(w);
    const help = helpButtonRect(w);
    expect(starMap.x + starMap.w + STAR_MAP_BUTTON_GAP).toBe(help.x);
    expect(starMap.y).toBe(help.y);
    expect(starMap.w).toBe(STAR_MAP_BUTTON_SIZE);
    expect(starMap.h).toBe(STAR_MAP_BUTTON_SIZE);
  });
});
