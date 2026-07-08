/**
 * Task 3 (font-scale layout bug-fix pack,
 * `docs/plans/20260708-font-scale-and-faction-bugs.md`): regression test for
 * `TextQuestScene.refreshVmParamPanel`'s per-param name/value stack. `yOff`
 * advanced by fixed pixel constants (+16 after the name line, +18 after the
 * value line) independent of `scaledFont`'s taller line height at "L" scale,
 * so the value line bled into the name line above it.
 *
 * Mirrors the lightweight `pixi.js` mock convention already used by this
 * scene's own `TextQuestScene.test.ts` (plain mutable `Container`/`Text`
 * objects), extended to record every created Text instance so its final,
 * post-construction `x`/`y` is inspectable after render.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { QuestScript } from "@/systems/quests/QuestScript";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import { lineStepFor } from "@/presentation/ui/questCardLayout";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

interface FakeNode {
  text: string;
  x: number;
  y: number;
  children: FakeNode[];
}

let created: FakeNode[] = [];

vi.mock("pixi.js", () => {
  class FakeBase {
    x = 0;
    y = 0;
    width = 80;
    height = 20;
    alpha = 1;
    eventMode = "auto";
    cursor = "auto";
    label = "";
    destroyed = false;
    parent: unknown = null;
    anchor = { set: () => {} };
    children: FakeNode[] = [];
    on() {
      return this;
    }
    addChild(c: FakeNode) {
      this.children.push(c);
      return c;
    }
    removeChild(c: FakeNode) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    }
    destroy() {}
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
    text: string;
    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
      created.push(this as unknown as FakeNode);
    }
  }
  class Sprite extends FakeBase {}
  return { Container, Graphics, Text, Sprite };
});

// Imported AFTER the mock so the scene sees the fake pixi.
import { TextQuestScene } from "@/presentation/TextQuestScene";

function makeRenderer() {
  return {
    app: { screen: { width: 900, height: 700 } },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;
}

function makeScript(): QuestScript {
  return {
    id: "vm_test",
    title: "VM тестовый квест",
    params: [
      {
        id: "health",
        name: "Здоровье",
        min: 0,
        max: 100,
        initial: 50,
        showInUI: true,
      },
    ],
    locations: [
      {
        id: "loc_a",
        text: "Начальная локация.",
        transitions: [],
      },
    ],
    startLocation: "loc_a",
  };
}

function makeEngine() {
  return {
    player: { credits: 1000 },
    transitionTo: vi.fn().mockResolvedValue(undefined),
  } as unknown as import("@/systems/GameEngine").GameEngine;
}

describe("TextQuestScene VM param panel at L font scale", () => {
  it("keeps the value line from overlapping the name line above it", () => {
    setFontScale("L");
    created = [];
    const renderer = makeRenderer();
    const scene = new TextQuestScene(renderer);
    scene.initialize({
      gameEngine: makeEngine(),
      questScript: makeScript(),
      seed: 1,
    });

    const nameIdx = created.findIndex((n) => n.text === "Здоровье");
    expect(nameIdx, "expected the param name Text node").toBeGreaterThanOrEqual(
      0,
    );
    const name = created[nameIdx];
    const value = created[nameIdx + 1];
    expect(value.text).toBe("50");

    const nameStep = lineStepFor(scaledFont(11));
    // The bug: the value line used to sit at a fixed +16 offset from the name
    // line regardless of scale; at "L" the name line's own height exceeds
    // that gap and the value line bleeds into it.
    expect(value.y).toBeGreaterThanOrEqual(name.y + nameStep);

    scene.destroy();
  });
});
