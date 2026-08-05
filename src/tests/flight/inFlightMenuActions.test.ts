import { describe, it, expect, afterEach, vi, type Mock } from "vitest";
import { Container, Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { wireFlightSystemMenu } from "@/presentation/flight/flightSystemMenu";
import { SceneType } from "@/types";
import { setFontScale } from "@/utils/fontScale";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

function makeRenderer(uiLayer: Container): Renderer {
  return {
    app: { screen: { width: 800, height: 600 } },
    stage: new Container(),
    uiLayer,
    gameLayer: new Container(),
  } as unknown as Renderer;
}

interface EngineSpies {
  loadGame: Mock;
  transitionTo: Mock;
}

function build(opts: { loadResolves?: boolean } = {}): {
  hud: FlightHud;
  uiLayer: Container;
  engine: EngineSpies;
  gameEngine: GameEngine;
} {
  const uiLayer = new Container();
  const renderer = makeRenderer(uiLayer);
  const loadGame = vi.fn(async () => opts.loadResolves ?? true);
  const transitionTo = vi.fn(async () => {});
  const gameEngine = {
    galaxy: { gameDays: 0 },
    audio: {
      playUiClick: () => {},
      playUiHover: () => {},
      playToast: () => {},
    },
    questManager: {},
    player: { getReputation: () => 0 },
    loadGame,
    transitionTo,
  } as unknown as GameEngine;
  const hud = new FlightHud(renderer, gameEngine, uiLayer);
  hud.initialize();
  wireFlightSystemMenu(hud, gameEngine);
  return { hud, uiLayer, engine: { loadGame, transitionTo }, gameEngine };
}

function allTexts(node: Container): Text[] {
  const out: Text[] = [];
  if (node instanceof Text) out.push(node);
  for (const child of node.children) {
    if (child instanceof Container) out.push(...allTexts(child));
  }
  return out;
}

function hasLabel(uiLayer: Container, label: string): boolean {
  return allTexts(uiLayer).some((t) => t.text === label);
}

function clickLabel(uiLayer: Container, label: string): void {
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No button labelled "${label}"`);
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", { stopPropagation: () => {} } as never);
}

describe("FlightHud — in-flight system menu actions", () => {
  it("«Загрузить сохранение» confirms, then «Да» loads the autosave once", () => {
    const { hud, uiLayer, engine } = build();

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Загрузить сохранение");

    expect(hud.isSystemMenuConfirmOpen()).toBe(true);
    expect(engine.loadGame).not.toHaveBeenCalled();
    expect(hasLabel(uiLayer, "Да")).toBe(true);
    expect(hasLabel(uiLayer, "Отмена")).toBe(true);

    clickLabel(uiLayer, "Да");

    expect(engine.loadGame).toHaveBeenCalledTimes(1);
    expect(engine.loadGame).toHaveBeenCalledWith("auto");
    expect(hud.isSystemMenuConfirmOpen()).toBe(false);

    hud.destroy();
  });

  it("«Отмена» on the confirm loads nothing and dismisses the panel", () => {
    const { hud, uiLayer, engine } = build();

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Загрузить сохранение");
    expect(hud.isSystemMenuConfirmOpen()).toBe(true);

    clickLabel(uiLayer, "Отмена");

    expect(engine.loadGame).not.toHaveBeenCalled();
    expect(hud.isSystemMenuConfirmOpen()).toBe(false);
    expect(hasLabel(uiLayer, "Да")).toBe(false);

    hud.destroy();
  });

  it("«В главное меню» transitions to MAIN_MENU once, passing the engine context", () => {
    const { hud, uiLayer, engine, gameEngine } = build();

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "В главное меню");

    expect(engine.transitionTo).toHaveBeenCalledTimes(1);
    expect(engine.transitionTo).toHaveBeenCalledWith(SceneType.MAIN_MENU, {
      gameEngine,
    });
    expect(engine.loadGame).not.toHaveBeenCalled();

    hud.destroy();
  });

  it("«Да» when the auto slot is missing (loadGame resolves false) toasts a failure, not silence", async () => {
    const { hud, uiLayer, engine } = build({ loadResolves: false });

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Загрузить сохранение");
    clickLabel(uiLayer, "Да");

    expect(engine.loadGame).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(hasLabel(uiLayer, "Не удалось загрузить сохранение")).toBe(true);

    hud.destroy();
  });

  it("[МЕНЮ] toggled while the confirm is open closes the modal, never stacks a menu", () => {
    const { hud, uiLayer } = build();

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Загрузить сохранение");
    expect(hud.isSystemMenuConfirmOpen()).toBe(true);

    hud.toggleSystemMenu();
    expect(hud.isSystemMenuConfirmOpen()).toBe(false);
    expect(hud.isSystemMenuOpen()).toBe(false);
    expect(hasLabel(uiLayer, "Да")).toBe(false);
    expect(hasLabel(uiLayer, "Продолжить")).toBe(false);

    hud.destroy();
  });

  it("destroying the HUD with the confirm open leaks no confirm objects", () => {
    const { hud, uiLayer } = build();

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Загрузить сохранение");
    expect(hud.isSystemMenuConfirmOpen()).toBe(true);

    hud.destroy();
    expect(hud.isSystemMenuConfirmOpen()).toBe(false);
    expect(hasLabel(uiLayer, "Да")).toBe(false);
  });
});
