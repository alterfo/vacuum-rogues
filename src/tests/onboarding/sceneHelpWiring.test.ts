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
  return {
    Container,
    Graphics,
    Text,
    Sprite,
    TilingSprite,
    Rectangle,
    Circle,
    FederatedPointerEvent: class {},
  };
});

const mountSceneHelp = vi.fn((..._args: unknown[]): (() => void) => () => {});
const showHelpOnce = vi.fn((..._args: unknown[]): (() => void) => () => {});
vi.mock("@/presentation/ui/mountSceneHelp", () => ({
  mountSceneHelp: (...args: unknown[]) => mountSceneHelp(...args),
  showHelpOnce: (...args: unknown[]) => showHelpOnce(...args),
}));

import { TradeScene } from "@/presentation/TradeScene";
import { StationScene } from "@/presentation/StationScene";
import { PlanetScene } from "@/presentation/PlanetScene";
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

describe("Task 4 — core-loop scenes wire contextual help", () => {
  beforeEach(() => {
    mountSceneHelp.mockClear();
    showHelpOnce.mockClear();
  });

  const cases: Array<{ name: string; SceneClass: unknown; key: HelpKey }> = [
    { name: "TradeScene", SceneClass: TradeScene, key: "TRADE" },
    { name: "StationScene", SceneClass: StationScene, key: "STATION" },
    { name: "PlanetScene", SceneClass: PlanetScene, key: "PLANET" },
  ];

  for (const { name, SceneClass, key } of cases) {
    it(`${name} mounts help for "${key}" on renderer.stage`, () => {
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

  const refuelCases: Array<{ name: string; SceneClass: unknown }> = [
    { name: "StationScene", SceneClass: StationScene },
    { name: "PlanetScene", SceneClass: PlanetScene },
  ];

  for (const { name, SceneClass } of refuelCases) {
    it(`${name} passes firstTimeKey "refuel" to mountSceneHelp`, () => {
      mountHelpFor(SceneClass as { prototype: { mountHelp(): void } });

      const options = mountSceneHelp.mock.calls[0]?.[2] as
        | { firstTimeKey?: HelpKey }
        | undefined;
      expect(options?.firstTimeKey).toBe("refuel");
    });
  }
});
