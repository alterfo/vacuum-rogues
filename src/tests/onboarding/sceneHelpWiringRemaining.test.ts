import { describe, it, expect, vi, beforeEach } from "vitest";

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

const fakeStage = { id: "stage" };
const renderer = { stage: fakeStage } as unknown as never;

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
      expect(deps.container).toBe(fakeStage);
      expect(deps.renderer).toBe(renderer);
    });
  }
});
