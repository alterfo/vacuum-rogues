/**
 * Task 3 (save-slots UI): the in-flight system menu gains a «Сохранения» entry
 * that opens the full save/load screen (named manual slots). This proves the
 * HUD exposes the button and that clicking it (real pointer path) fans out
 * through {@link wireFlightSystemMenu} into a transition to
 * {@link SceneType.SAVE_LOAD} with `returnTo: SPACE_FLIGHT` — so closing the
 * screen drops the player back into flight.
 *
 * Built against a REAL PixiJS scene graph (mirrors inFlightMenuActions.test.ts).
 */
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

function build(): {
  hud: FlightHud;
  uiLayer: Container;
  transitionTo: Mock;
  gameEngine: GameEngine;
} {
  const uiLayer = new Container();
  const renderer = makeRenderer(uiLayer);
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
    loadGame: vi.fn(async () => true),
    transitionTo,
  } as unknown as GameEngine;
  const hud = new FlightHud(renderer, gameEngine, uiLayer);
  hud.initialize();
  wireFlightSystemMenu(hud, gameEngine); // same code path as SpaceFlightScene
  return { hud, uiLayer, transitionTo, gameEngine };
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

function clickLabel(uiLayer: Container, label: string): void {
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No button labelled "${label}"`);
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", { stopPropagation: () => {} } as never);
}

describe("FlightHud — in-flight «Сохранения» entry", () => {
  it("exposes «Сохранения» alongside the existing menu actions", () => {
    const { hud, uiLayer } = build();

    hud.toggleSystemMenu();

    expect(hasLabel(uiLayer, "Сохранения")).toBe(true);
    // The existing actions are unchanged.
    expect(hasLabel(uiLayer, "Продолжить")).toBe(true);
    expect(hasLabel(uiLayer, "Загрузить сохранение")).toBe(true);
    expect(hasLabel(uiLayer, "В главное меню")).toBe(true);

    hud.destroy();
  });

  it("clicking «Сохранения» opens the SAVE_LOAD screen, returning to flight", () => {
    const { hud, uiLayer, transitionTo, gameEngine } = build();

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Сохранения");

    expect(transitionTo).toHaveBeenCalledTimes(1);
    expect(transitionTo).toHaveBeenCalledWith(SceneType.SAVE_LOAD, {
      gameEngine,
      returnTo: SceneType.SPACE_FLIGHT,
    });

    hud.destroy();
  });
});
