import { describe, expect, it } from "vitest";
import {
  RESPONSE_BUTTON_BASE_OFFSET,
  RESPONSE_BUTTON_GAP,
  firstResponseButtonY,
} from "@/presentation/ui/dialogueLayout";

describe("firstResponseButtonY", () => {
  it("keeps the historical offset for short text", () => {
    expect(firstResponseButtonY(50, 150, 20)).toBe(
      50 + RESPONSE_BUTTON_BASE_OFFSET,
    );
  });

  it("starts below a tall wrapped text block", () => {
    const y = firstResponseButtonY(50, 150, 300);
    expect(y).toBe(150 + 300 + RESPONSE_BUTTON_GAP);
    expect(y).toBeGreaterThanOrEqual(150 + 300);
  });

  it("falls back to the base offset when the height is unknown", () => {
    expect(firstResponseButtonY(50, 150, Number.NaN)).toBe(
      50 + RESPONSE_BUTTON_BASE_OFFSET,
    );
    expect(firstResponseButtonY(50, 150, 0)).toBe(
      50 + RESPONSE_BUTTON_BASE_OFFSET,
    );
  });
});
