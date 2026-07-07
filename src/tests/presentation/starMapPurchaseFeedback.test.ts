/**
 * Bug 7: the star-map purchase deducted credits from the domain immediately,
 * but the planet-scene credits HUD is a one-shot `Text` snapshot built once in
 * `createUI()` and never refreshed, so the balance looked unchanged on
 * screen. The purchase toast also only said «Открыто систем: N» with no price
 * confirmation, so a `0`-systems-revealed purchase looked like nothing
 * happened at all.
 */
import { describe, it, expect } from "vitest";
import { Container, Text } from "pixi.js";
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
  revealSystemsWithinHops: (systemId: string, hops: number) => number;
}

/** Build an openStarMap-ready PlanetScene without its constructor/initialize. */
function makeScene(credits: number, revealed: number) {
  const scene = Object.create(PlanetScene.prototype) as PlanetScene;
  const uiLayer = new Container();
  const uiContainer = new Container();
  const planet = { id: "planet-1" };
  const galaxy: StubGalaxy = {
    systems: [{ id: "sys-1", planets: [planet] }],
    revealSystemsWithinHops: () => revealed,
  };
  const player = { credits };
  const fields = scene as unknown as Record<string, unknown>;
  fields.planet = planet;
  fields.gameEngine = { player, galaxy };
  fields.renderer = { app: { screen: { width: 800, height: 600 } }, uiLayer };
  fields.uiContainer = uiContainer;
  const creditsHudText = new Text({ text: `${credits} ₡` });
  fields.creditsHudText = creditsHudText;
  return {
    uiLayer,
    uiContainer,
    player,
    creditsHudText,
    open: () => (scene as unknown as { openStarMap(): void }).openStarMap(),
    refresh: () =>
      (scene as unknown as { refreshCreditsHud(): void }).refreshCreditsHud(),
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

function clickButton(btn: Container): void {
  btn.emit("pointerdown", { stopPropagation: () => {} } as never);
}

describe("refreshCreditsHud", () => {
  it("updates the stored credits Text in place from the live player balance", () => {
    const { creditsHudText, refresh } = makeScene(5000, 0);
    (creditsHudText as unknown as { text: string }).text = "stale";
    // Mutate credits directly (bypassing the purchase flow) to isolate the
    // refresh helper itself.
    refresh();
    expect(creditsHudText.text).toBe(`${(5000).toLocaleString("ru")} ₡`);
  });
});

describe("star-map purchase feedback (Bug 7)", () => {
  it("drops the credits HUD label after a tier purchase", () => {
    const { uiLayer, open, creditsHudText, player } = makeScene(5000, 2);
    open();
    const modal = uiLayer.children[0] as Container;
    const tierBtn = findButton(modal, "Ближняя (1 переход) — 500 ₡");
    expect(tierBtn).toBeDefined();

    clickButton(tierBtn!);

    expect(player.credits).toBe(4500);
    expect(creditsHudText.text).toBe(`${(4500).toLocaleString("ru")} ₡`);
  });

  it("confirms the price paid in the toast when systems are revealed", () => {
    const { uiLayer, uiContainer, open } = makeScene(5000, 2);
    open();
    const modal = uiLayer.children[0] as Container;
    const tierBtn = findButton(modal, "Ближняя (1 переход) — 500 ₡");
    clickButton(tierBtn!);

    const toast = uiContainer.getChildByLabel?.("planet-toast") as
      | Text
      | undefined;
    expect(toast).toBeDefined();
    expect(toast!.text).toContain("500");
    expect(toast!.text).toContain("2");
  });

  it("still confirms the spend when no new systems are revealed", () => {
    const { uiLayer, uiContainer, open } = makeScene(5000, 0);
    open();
    const modal = uiLayer.children[0] as Container;
    const tierBtn = findButton(modal, "Ближняя (1 переход) — 500 ₡");
    clickButton(tierBtn!);

    const toast = uiContainer.getChildByLabel?.("planet-toast") as
      | Text
      | undefined;
    expect(toast).toBeDefined();
    expect(toast!.text).toContain("500");
    expect(toast!.text.toLowerCase()).not.toBe("500");
  });
});
