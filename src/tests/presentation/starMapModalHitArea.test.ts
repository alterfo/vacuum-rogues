/**
 * Real-pointer regression (playtest): the star-map purchase modal's buttons are
 * hand-rolled Containers whose children (bg Graphics + label Text) are all
 * eventMode='none'. In PixiJS 8 that leaves the Container with NO hit-test
 * geometry — the event boundary prunes 'none' children and a bare Container
 * contributes no bounds — so the button is mouse-dead without an explicit
 * hitArea (same trap as UiButton, see uiButtonHitArea.test.ts).
 *
 * Reported bug: with insufficient credits the only enabled action is "Закрыть",
 * and that button did nothing under a real mouse — the modal could not be closed.
 */
import { describe, it, expect } from "vitest";
import { Container, Rectangle, type Text } from "pixi.js";
import { PlanetScene } from "@/presentation/PlanetScene";

// scaledFont() reads localStorage; ensure it exists (Node 26 shadows jsdom's).
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

interface StubGalaxy {
  systems: Array<{ id: string; planets: Array<{ id: string }> }>;
  revealSystemsWithinHops: () => number;
}

/** Build an openStarMap-ready PlanetScene without its constructor/initialize. */
function makeScene(credits: number): { uiLayer: Container; open: () => void } {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const uiLayer = new Container();
  const planet = { id: "planet-1" };
  const galaxy: StubGalaxy = {
    systems: [{ id: "sys-1", planets: [planet] }],
    revealSystemsWithinHops: () => 0,
  };
  const fields = scene as unknown as Record<string, unknown>;
  fields.planet = planet;
  fields.gameEngine = {
    player: { credits, toLocaleString: () => String(credits) },
    galaxy,
  };
  fields.renderer = { app: { screen: { width: 800, height: 600 } }, uiLayer };
  return {
    uiLayer,
    open: () => (scene as unknown as { openStarMap(): void }).openStarMap(),
  };
}

/** Find the button Container whose label Text matches `label`. */
function findButton(modal: Container, label: string): Container | undefined {
  return modal.children.find(
    (c): c is Container =>
      c instanceof Container &&
      c.children.some(
        (ch) => (ch as Text).text !== undefined && (ch as Text).text === label,
      ),
  );
}

describe("star-map modal button hit geometry", () => {
  it("gives the 'Закрыть' button an explicit hitArea when credits are insufficient", () => {
    const { uiLayer, open } = makeScene(0);
    open();
    const modal = uiLayer.children[0] as Container;

    const closeBtn = findButton(modal, "Закрыть");
    expect(closeBtn).toBeDefined();
    expect(closeBtn!.eventMode).toBe("static");
    const hit = closeBtn!.hitArea as Rectangle;
    expect(hit).toBeInstanceOf(Rectangle);
    expect(hit.width).toBe(380);
    expect(hit.height).toBe(40);
  });

  it("gives affordable tier buttons a hitArea too", () => {
    const { uiLayer, open } = makeScene(5000);
    open();
    const modal = uiLayer.children[0] as Container;

    const tierBtn = findButton(modal, "Ближняя (1 переход) — 500 ₡");
    expect(tierBtn).toBeDefined();
    expect((tierBtn!.hitArea as Rectangle)?.constructor).toBe(Rectangle);
  });
});
