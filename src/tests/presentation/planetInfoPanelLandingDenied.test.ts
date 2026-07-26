/**
 * Task 11 (quest-and-hub polish pass): the `PlanetInfoPanel` «Приземлиться»
 * button must re-check the landing gate at click time. When landing is denied
 * (Overmind / pirate-rep), clicking the button must NO-OP — it must not invoke
 * the `onLand` callback (which downstream shows a denial message and ends the
 * turn, wasting a game day). When landing is allowed the click still lands.
 *
 * A lightweight `pixi.js` mock records every node's text plus its registered
 * event handlers, so the land button's `pointerdown` can be fired directly
 * without a canvas or pointer device.
 */
import { describe, it, expect, vi } from "vitest";

interface FakeNode {
  text: string;
  cursor: string;
  handlers: Record<string, (e: { stopPropagation: () => void }) => void>;
}

let nodes: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    alpha = 1;
    eventMode = "auto";
    cursor = "default";
    destroyed = false;
    parent: unknown = null;
    children: unknown[] = [];
    text = "";
    handlers: Record<string, (e: { stopPropagation: () => void }) => void> = {};
    anchor = { set: () => {} };
    on(ev: string, fn: (e: { stopPropagation: () => void }) => void) {
      this.handlers[ev] = fn;
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
    destroy() {
      this.destroyed = true;
    }
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
  }
  class Text extends FakeBase {
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
      nodes.push(this as unknown as FakeNode);
    }
  }
  return { Container, Graphics, Text };
});

// Imported AFTER the mock so the panel sees the fake pixi.
import { PlanetInfoPanel } from "@/presentation/PlanetInfoPanel";

function habitablePlanet() {
  return {
    name: "Терра",
    type: "TERRESTRIAL",
    isHabitable: true,
    drones: 0,
  } as unknown as import("@/domain/Planet").Planet;
}

function buildPanel(landingDenialText?: string): {
  onLand: ReturnType<typeof vi.fn>;
  landButton: FakeNode | undefined;
  texts: string[];
} {
  nodes = [];
  const onLand = vi.fn();
  const panel = new PlanetInfoPanel(
    habitablePlanet(),
    1000,
    800,
    3,
    onLand,
    undefined, // ownerFaction
    undefined, // economyType
    undefined, // politicalSystem
    undefined, // reputation
    landingDenialText,
  );
  const captured = [...nodes];
  const landButton = captured.find((n) => n.text === "[Приземлиться]");
  const texts = captured.map((n) => n.text);
  panel.destroy();
  return { onLand, landButton, texts };
}

function click(node: FakeNode | undefined): void {
  node?.handlers["pointerdown"]?.({ stopPropagation: () => {} });
}

describe("PlanetInfoPanel landing-denied button", () => {
  it("clicking the land button lands when landing is allowed", () => {
    const { onLand, landButton } = buildPanel(undefined);
    expect(landButton).toBeDefined();
    click(landButton);
    expect(onLand).toHaveBeenCalledTimes(1);
  });

  it("clicking the land button no-ops when landing is denied", () => {
    const { onLand, landButton } = buildPanel("Овермайнд удерживает систему");
    expect(landButton).toBeDefined();
    click(landButton);
    // No land attempt — so no downstream message + turn-end (wasted game day).
    expect(onLand).not.toHaveBeenCalled();
  });

  it("renders the denial reason line when landing is denied", () => {
    const reason = "Пираты: нужна репутация";
    const { texts } = buildPanel(reason);
    expect(texts).toContain(reason);
  });

  it("shows the denied button as non-interactive (default cursor)", () => {
    const { landButton } = buildPanel("Овермайнд удерживает систему");
    expect(landButton?.cursor).toBe("default");
  });

  it("keeps the allowed button interactive (pointer cursor)", () => {
    const { landButton } = buildPanel(undefined);
    expect(landButton?.cursor).toBe("pointer");
  });
});
