import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug 3 of `docs/plans/20260626-playtest-bugs-2-pause-victory-onboarding-accessibility.md`:
 * the faction-selection / new-game screen (`RaceSelectionScene`) was never wired
 * into the contextual-help system. It now opts in like every other scene — one
 * `mountSceneHelp(..., "RACE_SELECTION")` line in `initialize()` (via the private
 * `mountHelp()` seam) and a teardown in `destroy()`. We assert it forwards the
 * right key on `renderer.stage` and releases the help layer on teardown (no leak).
 *
 * Mirrors `sceneHelpWiringRemaining.test.ts`: a minimal pixi double + an
 * `Object.create` scene shell keep the test off the heavy `initialize()` render
 * path; the scene only forwards the key + the teardown to the helper.
 */

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

// Mock the helper to a spy that hands back a teardown spy we can assert is called.
const teardown = vi.fn();
const mountSceneHelp = vi.fn((..._args: unknown[]): (() => void) => teardown);
vi.mock("@/presentation/ui/mountSceneHelp", () => ({
  mountSceneHelp: (...args: unknown[]) => mountSceneHelp(...args),
  showHelpOnce: vi.fn((..._args: unknown[]): (() => void) => () => {}),
}));

import { RaceSelectionScene } from "@/presentation/RaceSelectionScene";
import type { HelpKey } from "@/systems/onboarding/helpContent";

const fakeStage = { id: "stage" };
const renderer = { stage: fakeStage } as unknown as never;

/**
 * Build a bare scene shell (no `initialize()` render path). Typed structurally
 * (not as `RaceSelectionScene`) so the private `mountHelp`/`destroy` members
 * don't reduce the cast to `never`; we only exercise the help-wiring seam.
 */
function makeScene(): {
  renderer: unknown;
  mountHelp(): void;
  destroy(): void;
} {
  const scene = Object.create(RaceSelectionScene.prototype) as {
    renderer: unknown;
    mountHelp(): void;
    destroy(): void;
  };
  scene.renderer = renderer;
  return scene;
}

describe("RaceSelectionScene contextual help", () => {
  beforeEach(() => {
    mountSceneHelp.mockClear();
    teardown.mockClear();
  });

  it('mounts help for "RACE_SELECTION" once on renderer.stage', () => {
    const scene = makeScene();
    scene.mountHelp();

    expect(mountSceneHelp).toHaveBeenCalledTimes(1);
    const [deps, key] = mountSceneHelp.mock.calls[0] as unknown as [
      { renderer: unknown; container: unknown },
      HelpKey,
    ];
    expect(key).toBe("RACE_SELECTION");
    expect(deps.container).toBe(fakeStage); // persistent stage, survives refresh()
    expect(deps.renderer).toBe(renderer);
  });

  it("tears the help layer down on destroy (no leak)", () => {
    const scene = makeScene();
    scene.mountHelp();
    expect(teardown).not.toHaveBeenCalled();

    scene.destroy();
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
