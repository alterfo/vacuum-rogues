import { describe, it, expect } from "vitest";
import { UiButton } from "@/presentation/ui/UiButton";
import { Rectangle } from "pixi.js";

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

  it("also stops the underlying native DOM event, not just Pixi's internal propagation", () => {
    const btn = new UiButton("", "Speed", "neutral", () => {});
    const nativeStop = () => {
      nativeStopCalled = true;
    };
    let nativeStopCalled = false;
    const event = {
      stopPropagation: () => {},
      nativeEvent: { stopPropagation: nativeStop },
    };

    btn.container.emit("pointerdown", event as never);

    expect(nativeStopCalled).toBe(true);
  });
});
