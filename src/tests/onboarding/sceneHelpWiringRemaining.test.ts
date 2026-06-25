import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Task 5 (onboarding): the remaining gameplay scenes wire contextual help in
 * their `mountHelp()` seam — each requests its own help key (so the first-time
 * hint + «?» reopen are for the right screen) and mounts it on `renderer.stage`
 * (which survives the scene's own UI rebuilds). We assert against a fake
 * `mountSceneHelp` spy: building the scene via `Object.create` + calling the
 * private `mountHelp()` directly keeps the test off the heavy `initialize()`
 * render path (the scene only forwards the key to the helper).
 *
 * Mirrors `sceneHelpWiring.test.ts` (the Task 4 core-loop scenes).
 */

// The scenes import pixi.js at module load (via scaledText/UiButton/panels);
// a minimal constructable fake lets them import without a real renderer.
vi.mock("pixi.js", () => {
  class FakeBase {
    children: unknown[] = [];
    anchor = { set: () => {} };
    scale = { set: () => {} };
    on() {
      return this;
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild() {}
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
    text = "";
    style: Record<string, unknown> = {};
  }
  class Sprite extends FakeBase {}
  class TilingSprite extends FakeBase {}
  class Rectangle {}
  class Circle {}
  class BlurFilter {}
  return {
    Container,
    Graphics,
    Text,
    Sprite,
    TilingSprite,
    Rectangle,
    Circle,
    BlurFilter,
    FederatedPointerEvent: class {},
  };
});

// The unit under test is the key each scene forwards — mock the helper to a spy.
const mountSceneHelp = vi.fn((..._args: unknown[]): (() => void) => () => {});
const showHelpOnce = vi.fn((..._args: unknown[]): (() => void) => () => {});
vi.mock("@/presentation/ui/mountSceneHelp", () => ({
  mountSceneHelp: (...args: unknown[]) => mountSceneHelp(...args),
  showHelpOnce: (...args: unknown[]) => showHelpOnce(...args),
}));

import { StarMapScene } from "@/presentation/StarMapScene";
import { BankScene } from "@/presentation/BankScene";
import { GovernmentScene } from "@/presentation/GovernmentScene";
import { EquipmentShopScene } from "@/presentation/EquipmentShopScene";
import { InfoCenterScene } from "@/presentation/InfoCenterScene";
import { InventoryScene } from "@/presentation/InventoryScene";
import { TextQuestScene } from "@/presentation/TextQuestScene";
import type { HelpKey } from "@/systems/onboarding/helpContent";

/** A stand-in renderer exposing only what `mountHelp()` reads: `stage`. */
const fakeStage = { id: "stage" };
const renderer = { stage: fakeStage } as unknown as never;

/** Build a scene shell and invoke its private `mountHelp()` (no `initialize()`). */
function mountHelpFor(SceneClass: { prototype: { mountHelp(): void } }): void {
  const scene = Object.create(SceneClass.prototype) as {
    renderer: unknown;
    mountHelp(): void;
  };
  scene.renderer = renderer;
  scene.mountHelp();
}

describe("Task 5 — remaining scenes wire contextual help", () => {
  beforeEach(() => {
    mountSceneHelp.mockClear();
    showHelpOnce.mockClear();
  });

  const cases: Array<{ name: string; SceneClass: unknown; key: HelpKey }> = [
    { name: "StarMapScene", SceneClass: StarMapScene, key: "STAR_MAP" },
    { name: "BankScene", SceneClass: BankScene, key: "BANK" },
    { name: "GovernmentScene", SceneClass: GovernmentScene, key: "GOVERNMENT" },
    {
      name: "EquipmentShopScene",
      SceneClass: EquipmentShopScene,
      key: "EQUIPMENT_SHOP",
    },
    {
      name: "InfoCenterScene",
      SceneClass: InfoCenterScene,
      key: "INFO_CENTER",
    },
    { name: "InventoryScene", SceneClass: InventoryScene, key: "INVENTORY" },
    { name: "TextQuestScene", SceneClass: TextQuestScene, key: "TEXT_QUEST" },
  ];

  for (const { name, SceneClass, key } of cases) {
    it(`${name} mounts help for "${key}" once on renderer.stage`, () => {
      mountHelpFor(SceneClass as { prototype: { mountHelp(): void } });

      expect(mountSceneHelp).toHaveBeenCalledTimes(1);
      const [deps, calledKey] = mountSceneHelp.mock.calls[0] as unknown as [
        { renderer: unknown; container: unknown },
        HelpKey,
      ];
      expect(calledKey).toBe(key);
      // Mounted above the UI on the persistent stage layer.
      expect(deps.container).toBe(fakeStage);
      expect(deps.renderer).toBe(renderer);
    });
  }
});
