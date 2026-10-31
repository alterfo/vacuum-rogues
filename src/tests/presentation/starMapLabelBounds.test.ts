import { afterEach, describe, expect, it } from "vitest";
import { scaledFont, setFontScale } from "@/utils/fontScale";
import {
  MONO_CHAR_WIDTH_RATIO,
  lineStepFor,
} from "@/presentation/ui/questCardLayout";
import { starMapLabelBounds } from "@/presentation/ui/starMapLabelBounds";

afterEach(() => {
  setFontScale("M");
});

describe("starMapLabelBounds", () => {
  it("derives width and height from the scaled label font", () => {
    const bounds = starMapLabelBounds("Солнце");
    expect(bounds.width).toBe(
      "Солнце".length * scaledFont(10) * MONO_CHAR_WIDTH_RATIO,
    );
    expect(bounds.height).toBe(lineStepFor(scaledFont(10)));
  });

  it("grows at the L font scale", () => {
    const atM = starMapLabelBounds("Солнце");
    setFontScale("L");
    const atL = starMapLabelBounds("Солнце");
    expect(atL.width).toBeGreaterThan(atM.width);
    expect(atL.height).toBeGreaterThan(atM.height);
  });
});
