/**
 * Task 1 (in-flight system menu): the always-available HUD menu lets a player
 * escape any dead-end (stranded, <30% hull, broke). This proves the HUD side of
 * it: the [МЕНЮ] button toggles a panel; the panel exposes the three actions
 * (Продолжить / Загрузить сохранение / В главное меню); the panel destroys
 * cleanly on close and on HUD teardown without leaking UI objects.
 *
 * Built against a REAL PixiJS scene graph (Container / Graphics / Text construct
 * in jsdom without WebGL) — mirrors fontScaleRestyle.test.ts.
 */
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

/** Recursively collect every PixiJS Text node under a display object. */
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

    // Click the real [МЕНЮ] HUD button (not toggleSystemMenu) so the button's own
    // wiring — eventMode + pointerdown handler — is exercised, per the project's
    // real-pointer-tests-for-hit-geometry rule.
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
    // The UI layer returns to exactly its pre-open child set.
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
    // A second close must not throw on an already-destroyed panel.
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

    // Drive the panel's buttons by clicking their containers (real pointer path).
    // Load / main-menu don't auto-close the panel in the HUD — the scene owns
    // that (loadGame transitions away), so both buttons stay clickable.
    hud.toggleSystemMenu();
    clickLabel(hud, "Загрузить сохранение");
    expect(loadCalls).toBe(1);
    expect(mainMenuCalls).toBe(0);

    clickLabel(hud, "В главное меню");
    expect(mainMenuCalls).toBe(1);

    hud.destroy();
  });
});

/**
 * Find the UiButton container whose label matches and emit a pointerdown on it,
 * exercising the real click path (UiButton's container is eventMode 'static').
 */
function clickLabel(hud: FlightHud, label: string): void {
  // The menu panel is mounted on the uiLayer; reach it through the HUD's layer.
  const uiLayer = (hud as unknown as { uiLayer: Container }).uiLayer;
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No menu button labelled "${label}"`);
  // Walk up to the UiButton container (the eventMode 'static' ancestor).
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", {
    stopPropagation: () => {},
  } as never);
}
