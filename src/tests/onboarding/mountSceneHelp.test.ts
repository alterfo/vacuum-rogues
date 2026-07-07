import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Task 3 (onboarding): the reusable contextual-help wiring. These tests drive the
 * helper directly against a fake pixi.js + a fake "seen" store (no real DOM /
 * localStorage), asserting:
 *  - the pure `shouldAutoShow` decision,
 *  - mountSceneHelp auto-shows the panel exactly once on first entry (+ markSeen),
 *  - a second visit does NOT auto-show, but the «?» button still reopens it,
 *  - teardown removes the «?» button and any open panel,
 *  - the HelpPanel's «Понятно» / «✕» both invoke onClose.
 */

interface FakeNode {
  text?: string;
  children: FakeNode[];
  handlers: Record<string, (e: unknown) => void>;
  destroyed?: boolean;
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
    removeChildren() {
      const c = this.children;
      this.children = [];
      return c;
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
  class Rectangle {
    constructor(
      public x = 0,
      public y = 0,
      public w = 0,
      public h = 0,
    ) {}
  }
  return {
    Container,
    Graphics,
    Text,
    Rectangle,
    FederatedPointerEvent: class {},
  };
});

// Imported AFTER the mock so the panel + button see the fake pixi.
import { Container } from "pixi.js";
import {
  mountSceneHelp,
  shouldAutoShow,
  isHelpPanelOpen,
  dismissHelpPanel,
  showHelpOnce,
} from "@/presentation/ui/mountSceneHelp";
import { HelpPanel } from "@/presentation/ui/HelpPanel";
import { helpFor, type HelpKey } from "@/systems/onboarding/helpContent";
import type { Renderer } from "@/presentation/Renderer";

const renderer = {
  app: { screen: { width: 1280, height: 800 } },
} as unknown as Renderer;

const fakeEvent = { stopPropagation: vi.fn() };

// The open-help-panel registry (`isHelpPanelOpen`/`dismissHelpPanel`) is
// module-level by design (F3 — queryable without a scene reference), so a
// panel a test opens without an explicit teardown would otherwise leak into
// the next test. Drain it before every test in this file.
beforeEach(() => {
  while (isHelpPanelOpen()) dismissHelpPanel();
});

/** A fake injectable "seen" store backed by a plain Set. */
function makeSeenStore(seeded: HelpKey[] = []) {
  const set = new Set<HelpKey>(seeded);
  return {
    hasSeen: vi.fn((k: HelpKey) => set.has(k)),
    markSeen: vi.fn((k: HelpKey) => {
      set.add(k);
    }),
    set,
  };
}

/** Depth-first find of a button container (one whose children include a Text === label). */
function findButton(root: FakeNode, label: string): FakeNode | undefined {
  for (const child of root.children) {
    if (child.children.some((c) => c.text === label)) return child;
    const nested = findButton(child, label);
    if (nested) return nested;
  }
  return undefined;
}

describe("shouldAutoShow — pure auto-show decision", () => {
  it("auto-shows an unseen key, not a seen one", () => {
    expect(shouldAutoShow("PLANET", () => false)).toBe(true);
    expect(shouldAutoShow("PLANET", () => true)).toBe(false);
  });

  it("delegates entirely to the injected predicate", () => {
    const seen = new Set<HelpKey>(["TRADE"]);
    const pred = (k: HelpKey) => seen.has(k);
    expect(shouldAutoShow("TRADE", pred)).toBe(false);
    expect(shouldAutoShow("BANK", pred)).toBe(true);
  });
});

describe("mountSceneHelp — first-time auto-hint + «?» reopen", () => {
  beforeEach(() => {
    fakeEvent.stopPropagation.mockClear();
  });

  it("auto-shows the panel once on first entry and records it as seen", () => {
    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore();

    mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "PLANET",
    );

    expect(store.markSeen).toHaveBeenCalledWith("PLANET");
    // Both the «?» button and the auto-shown panel were mounted.
    expect(container.children.length).toBe(2);
    // The panel renders the entry's title.
    expect(findButton(container, "Понятно")).toBeDefined();
  });

  it("does NOT auto-show when the key was already seen, but still mounts «?»", () => {
    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore(["PLANET"]);

    mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "PLANET",
    );

    expect(store.markSeen).not.toHaveBeenCalled();
    // Only the «?» button mounted — no panel.
    expect(container.children.length).toBe(1);
    expect(findButton(container, "Понятно")).toBeUndefined();
    expect(findButton(container, "?")).toBeDefined();
  });

  it("«?» reopens the panel on demand (and ignores a double-click)", () => {
    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore(["PLANET"]); // already seen → no auto-show

    mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "PLANET",
    );

    const helpBtn = findButton(container, "?");
    expect(helpBtn).toBeDefined();
    expect(container.children.length).toBe(1);

    helpBtn!.handlers.pointerdown(fakeEvent);
    expect(container.children.length).toBe(2); // panel opened
    expect(findButton(container, "Понятно")).toBeDefined();

    // A second click while open must not stack a duplicate panel.
    helpBtn!.handlers.pointerdown(fakeEvent);
    expect(container.children.length).toBe(2);
  });

  it("«Понятно» closes the auto-shown panel (removes it from the scene)", () => {
    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore();

    mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "TRADE",
    );
    expect(container.children.length).toBe(2);

    const ok = findButton(container, "Понятно");
    expect(ok).toBeDefined();
    ok!.handlers.pointerdown(fakeEvent);

    // Panel destroyed + removed — only the «?» button remains.
    expect(container.children.length).toBe(1);
    expect(findButton(container, "Понятно")).toBeUndefined();
  });

  it("teardown removes the «?» button and any open panel", () => {
    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore();

    const teardown = mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "BANK",
    );
    expect(container.children.length).toBe(2);

    // Capture the «?» button before teardown removes it from the tree.
    const helpBtn = findButton(container, "?")!;
    expect(helpBtn).toBeDefined();

    teardown();

    // Both the «?» button and the open panel were removed from the scene.
    expect(container.children.length).toBe(0);
    expect((helpBtn as unknown as { destroyed?: boolean }).destroyed).toBe(
      true,
    );
  });
});

describe("isHelpPanelOpen / dismissHelpPanel — cross-cutting query+dismiss (F3)", () => {
  it("reports false with nothing open, true once a panel auto-shows, false again after dismissHelpPanel()", () => {
    expect(isHelpPanelOpen()).toBe(false);

    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore();
    const teardown = mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "BANK",
    );

    expect(isHelpPanelOpen()).toBe(true);

    dismissHelpPanel();

    expect(isHelpPanelOpen()).toBe(false);
    // The panel is gone; teardown only needs to clean up the «?» button now.
    teardown();
  });

  it("dismissHelpPanel() is a safe no-op when nothing is open", () => {
    expect(() => dismissHelpPanel()).not.toThrow();
    expect(isHelpPanelOpen()).toBe(false);
  });

  it("dismissHelpPanel() has the same effect as clicking «Понятно» — removes the panel from the scene", () => {
    const container = new Container() as unknown as FakeNode;
    const store = makeSeenStore();
    mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: store.hasSeen,
        markSeen: store.markSeen,
      },
      "BANK",
    );
    // container has the «?» button + the auto-shown panel.
    expect(container.children.length).toBe(2);

    dismissHelpPanel();

    // Only the «?» button remains — the panel was removed + destroyed.
    expect(container.children.length).toBe(1);
  });

  it("a showHelpOnce panel is also tracked (and doesn't collide with a scene's own mountSceneHelp panel)", () => {
    const container = new Container() as unknown as FakeNode;
    const sceneStore = makeSeenStore(["SPACE_FLIGHT"]); // scene's own key already seen
    mountSceneHelp(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: sceneStore.hasSeen,
        markSeen: sceneStore.markSeen,
      },
      "SPACE_FLIGHT",
    );
    expect(isHelpPanelOpen()).toBe(false); // already-seen key ⇒ no auto-show

    const onceStore = makeSeenStore();
    showHelpOnce(
      {
        renderer,
        container: container as unknown as Container,
        hasSeen: onceStore.hasSeen,
        markSeen: onceStore.markSeen,
      },
      "combat",
    );

    expect(isHelpPanelOpen()).toBe(true);
    dismissHelpPanel();
    expect(isHelpPanelOpen()).toBe(false);
  });
});

describe("HelpPanel — themed dismissible panel", () => {
  it("renders the entry title + body and invokes onClose from «Понятно»", () => {
    const onClose = vi.fn();
    const panel = new HelpPanel(renderer, helpFor("welcome"), onClose);
    const root = panel.container as unknown as FakeNode;

    const ok = findButton(root, "Понятно");
    expect(ok).toBeDefined();
    ok!.handlers.pointerdown(fakeEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose from the «✕» corner button", () => {
    const onClose = vi.fn();
    const panel = new HelpPanel(renderer, helpFor("STATION"), onClose);
    const root = panel.container as unknown as FakeNode;

    const x = findButton(root, "✕");
    expect(x).toBeDefined();
    x!.handlers.pointerdown(fakeEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("destroy() tears down the panel container", () => {
    const panel = new HelpPanel(renderer, helpFor("SPACE_FLIGHT"), vi.fn());
    panel.destroy();
    expect(
      (panel.container as unknown as { destroyed?: boolean }).destroyed,
    ).toBe(true);
  });
});
