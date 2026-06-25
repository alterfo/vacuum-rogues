import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Task 4 (onboarding): the flight scene's contextual-help layer
 * (`flightSceneHelp.ts`) + the pure auto-show decision it relies on. Drives the
 * real helper against a fake pixi + the real (jsdom) `localStorage` seen-store,
 * reset between tests, asserting:
 *  - `pickAutoShowKey` favours the welcome intro, then the screen key, then none,
 *  - a brand-new player's first flight auto-shows the `welcome`/goal panel,
 *  - the next flight (welcome seen) auto-shows the `SPACE_FLIGHT` controls hint,
 *  - the first in-flight engagement shows the one-shot `combat` hint (once ever),
 *  - `showHelpOnce` is a true one-shot.
 */

interface FakeNode {
  text?: string;
  children: FakeNode[];
  handlers: Record<string, (e: unknown) => void>;
}

vi.mock("pixi.js", () => {
  class FakeBase {
    handlers: Record<string, (e: unknown) => void> = {};
    children: unknown[] = [];
    x = 0;
    y = 0;
    width = 50;
    height = 14;
    alpha = 1;
    tint = 0xffffff;
    eventMode = "auto";
    cursor = "default";
    visible = true;
    hitArea: unknown = null;
    style: Record<string, unknown> = {};
    anchor = { set: () => {} };
    scale = { set: () => {} };
    on(ev: string, cb: (e: unknown) => void) {
      this.handlers[ev] = cb;
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild(c: unknown) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    }
    destroy() {
      (this as unknown as { destroyed: boolean }).destroyed = true;
    }
  }
  class Container extends FakeBase {}
  class Graphics extends FakeBase {
    rect() {
      return this;
    }
    roundRect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
    clear() {
      return this;
    }
  }
  class Text extends FakeBase {
    text = "";
    constructor(opts?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = opts?.text ?? "";
      this.style = opts?.style ?? {};
    }
  }
  class Rectangle {}
  return {
    Container,
    Graphics,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

import { Container } from "pixi.js";
import { mountFlightSceneHelp } from "@/presentation/flight/flightSceneHelp";
import {
  pickAutoShowKey,
  showHelpOnce,
} from "@/presentation/ui/mountSceneHelp";
import { helpFor, type HelpKey } from "@/systems/onboarding/helpContent";
import { resetSeen } from "@/systems/onboarding/onboardingState";
import type { Renderer } from "@/presentation/Renderer";

/** Depth-first: is any descendant a Text node whose `text` equals `value`? */
function hasText(root: FakeNode, value: string): boolean {
  for (const child of root.children) {
    if (child.text === value) return true;
    if (hasText(child, value)) return true;
  }
  return false;
}

function makeRenderer(stage: Container): Renderer {
  return {
    app: { screen: { width: 1280, height: 800 } },
    stage,
  } as unknown as Renderer;
}

const WELCOME = helpFor("welcome").title;
const FLIGHT = helpFor("SPACE_FLIGHT").title;
const COMBAT = helpFor("combat").title;

describe("pickAutoShowKey — welcome intro wins, then screen key, then none", () => {
  const seenSet = (...seeded: HelpKey[]) => {
    const set = new Set<HelpKey>(seeded);
    return (k: HelpKey) => set.has(k);
  };

  it("auto-shows the welcome intro on the very first flight", () => {
    expect(pickAutoShowKey("SPACE_FLIGHT", "welcome", seenSet())).toBe(
      "welcome",
    );
  });

  it("falls through to the screen key once the intro is seen", () => {
    expect(pickAutoShowKey("SPACE_FLIGHT", "welcome", seenSet("welcome"))).toBe(
      "SPACE_FLIGHT",
    );
  });

  it("auto-shows nothing once both are seen", () => {
    expect(
      pickAutoShowKey(
        "SPACE_FLIGHT",
        "welcome",
        seenSet("welcome", "SPACE_FLIGHT"),
      ),
    ).toBeNull();
  });

  it("with no intro, just the screen key's own first-time rule", () => {
    expect(pickAutoShowKey("PLANET", undefined, seenSet())).toBe("PLANET");
    expect(pickAutoShowKey("PLANET", undefined, seenSet("PLANET"))).toBeNull();
  });
});

describe("mountFlightSceneHelp — first-flight welcome, then flight hint, then combat", () => {
  beforeEach(() => {
    resetSeen(); // start every test as a brand-new player
  });

  it("greets a brand-new player with the welcome/goal panel + a «?» button", () => {
    const stage = new Container();
    const help = mountFlightSceneHelp(makeRenderer(stage));
    const root = stage as unknown as FakeNode;

    // The welcome intro auto-shows on the very first flight (not the flight hint).
    expect(hasText(root, WELCOME)).toBe(true);
    expect(hasText(root, FLIGHT)).toBe(false);
    help.destroy();
  });

  it("auto-shows the flight-controls hint on the next flight (welcome seen)", () => {
    // First flight consumes the welcome intro.
    mountFlightSceneHelp(makeRenderer(new Container())).destroy();

    // Second flight: welcome is seen, so the SPACE_FLIGHT controls hint shows.
    const stage = new Container();
    const help = mountFlightSceneHelp(makeRenderer(stage));
    const root = stage as unknown as FakeNode;
    expect(hasText(root, FLIGHT)).toBe(true);
    expect(hasText(root, WELCOME)).toBe(false);
    help.destroy();
  });

  it("shows the one-shot combat hint on the first engagement only", () => {
    const stage = new Container();
    const help = mountFlightSceneHelp(makeRenderer(stage));
    const root = stage as unknown as FakeNode;

    expect(hasText(root, COMBAT)).toBe(false); // no fight yet

    help.maybeShowCombatHint(true); // first engagement
    expect(hasText(root, COMBAT)).toBe(true);

    help.maybeShowCombatHint(false); // fight ended (re-arms the edge guard)
    help.maybeShowCombatHint(true); // a later fight — already seen, no re-show
    const combatPanels = countText(root, COMBAT);
    expect(combatPanels).toBe(1);
    help.destroy();
  });
});

describe("showHelpOnce — a true one-shot hint", () => {
  beforeEach(() => resetSeen());

  it("mounts the panel the first time and is a no-op thereafter", () => {
    const stage = new Container();
    const renderer = makeRenderer(stage);
    const root = stage as unknown as FakeNode;

    showHelpOnce({ renderer, container: stage }, "combat");
    expect(hasText(root, COMBAT)).toBe(true);

    showHelpOnce({ renderer, container: stage }, "combat"); // already seen
    expect(countText(root, COMBAT)).toBe(1);
  });
});

/** Count Text descendants whose `text` equals `value`. */
function countText(root: FakeNode, value: string): number {
  let n = 0;
  for (const child of root.children) {
    if (child.text === value) n += 1;
    n += countText(child, value);
  }
  return n;
}
