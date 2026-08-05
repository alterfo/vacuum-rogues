import { describe, it, expect, afterEach } from "vitest";
import { Container, Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
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

function build(): { hud: FlightHud; uiLayer: Container } {
  const uiLayer = new Container();
  const renderer = makeRenderer(uiLayer);
  const gameEngine = {
    galaxy: { gameDays: 0 },
    audio: {
      playUiClick: () => {},
      playUiHover: () => {},
      playToast: () => {},
    },
    questManager: {},
    player: { getReputation: () => 0 },
  } as unknown as GameEngine;
  const hud = new FlightHud(renderer, gameEngine, uiLayer);
  return { hud, uiLayer };
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

describe("FlightHud — in-flight system menu", () => {
  it("toggles the panel open and closed", () => {
    const { hud } = build();
    hud.initialize();

    expect(hud.isSystemMenuOpen()).toBe(false);

    hud.toggleSystemMenu();
    expect(hud.isSystemMenuOpen()).toBe(true);

    hud.toggleSystemMenu();
    expect(hud.isSystemMenuOpen()).toBe(false);

    hud.destroy();
  });

  it("opens the panel when the [МЕНЮ] button is clicked (real pointer path)", () => {
    const { hud, uiLayer } = build();
    hud.initialize();

    expect(hud.isSystemMenuOpen()).toBe(false);

    const menuBtn = allTexts(uiLayer).find((t) => t.text === "[МЕНЮ]");
    expect(menuBtn, "the [МЕНЮ] HUD button exists").toBeDefined();
    expect(menuBtn!.eventMode).toBe("static");
    menuBtn!.emit("pointerdown", { stopPropagation: () => {} } as never);

    expect(hud.isSystemMenuOpen()).toBe(true);

    hud.destroy();
  });

  it("exposes Продолжить / Загрузить сохранение / В главное меню while open", () => {
    const { hud, uiLayer } = build();
    hud.initialize();

    hud.toggleSystemMenu();

    expect(hasLabel(uiLayer, "Продолжить")).toBe(true);
    expect(hasLabel(uiLayer, "Загрузить сохранение")).toBe(true);
    expect(hasLabel(uiLayer, "В главное меню")).toBe(true);

    hud.destroy();
  });

  it("closing the panel removes its action labels (no leak on close)", () => {
    const { hud, uiLayer } = build();
    hud.initialize();

    const childrenBefore = uiLayer.children.length;

    hud.toggleSystemMenu();
    expect(uiLayer.children.length).toBeGreaterThan(childrenBefore);

    hud.toggleSystemMenu(); // close
    expect(hud.isSystemMenuOpen()).toBe(false);
    expect(hasLabel(uiLayer, "Загрузить сохранение")).toBe(false);
    expect(uiLayer.children.length).toBe(childrenBefore);

    hud.destroy();
  });

  it("closeSystemMenu is idempotent and leaves nothing behind", () => {
    const { hud, uiLayer } = build();
    hud.initialize();

    hud.toggleSystemMenu();
    expect(hud.isSystemMenuOpen()).toBe(true);

    hud.closeSystemMenu();
    expect(hud.isSystemMenuOpen()).toBe(false);
    expect(() => hud.closeSystemMenu()).not.toThrow();
    expect(hasLabel(uiLayer, "В главное меню")).toBe(false);

    hud.destroy();
  });

  it("destroying the HUD while the menu is open leaks no menu objects", () => {
    const { hud, uiLayer } = build();
    hud.initialize();

    hud.toggleSystemMenu();
    expect(hud.isSystemMenuOpen()).toBe(true);

    hud.destroy();
    expect(hud.isSystemMenuOpen()).toBe(false);
    expect(hasLabel(uiLayer, "Загрузить сохранение")).toBe(false);
  });

  it("the menu button fans actions out via onLoadSave / onMainMenu callbacks", () => {
    const { hud } = build();
    hud.initialize();

    let loadCalls = 0;
    let mainMenuCalls = 0;
    hud.onLoadSave = () => loadCalls++;
    hud.onMainMenu = () => mainMenuCalls++;

    hud.toggleSystemMenu();
    clickLabel(hud, "Загрузить сохранение");
    expect(loadCalls).toBe(1);
    expect(mainMenuCalls).toBe(0);

    clickLabel(hud, "В главное меню");
    expect(mainMenuCalls).toBe(1);

    hud.destroy();
  });
});

function clickLabel(hud: FlightHud, label: string): void {
  const uiLayer = (hud as unknown as { uiLayer: Container }).uiLayer;
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No menu button labelled "${label}"`);
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", {
    stopPropagation: () => {},
  } as never);
}
