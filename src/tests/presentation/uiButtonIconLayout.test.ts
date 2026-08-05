import { describe, it, expect } from "vitest";
import { UiButton } from "@/presentation/ui/UiButton";
import type { Text } from "pixi.js";

describe("UiButton icon/label layout modes", () => {
  function childText(btn: UiButton, index: 2 | 3): Text {
    return btn.container.children[index] as Text;
  }

  it("icon-only: centers the icon and hides the label", () => {
    const btn = new UiButton("★", "", 0xffaa00, () => {}, 40, 32);
    const icon = childText(btn, 2);
    const label = childText(btn, 3);

    expect(icon.x).toBe(20);
    expect(icon.y).toBe(16);
    expect(label.visible).toBe(false);
  });

  it("label-only: left-aligns the label and hides the icon", () => {
    const btn = new UiButton("", "1×", "neutral", () => {}, 52, 28);
    const icon = childText(btn, 2);
    const label = childText(btn, 3);

    expect(label.x).toBe(10);
    expect(icon.visible).toBe(false);
  });

  it("icon+label: places the icon on the left and the label after it", () => {
    const btn = new UiButton("▶", "Ход", "primary", () => {}, 120, 40);
    const icon = childText(btn, 2);
    const label = childText(btn, 3);

    expect(icon.x).toBe(16);
    expect(icon.y).toBe(20);
    expect(label.x).toBe(32);
  });
});
