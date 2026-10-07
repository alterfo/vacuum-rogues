import { describe, it, expect } from "vitest";
import { Container, type Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";

function makeRenderer(uiLayer: Container, w = 800, h = 600): Renderer {
  return {
    app: { screen: { width: w, height: h } },
    stage: new Container(),
    uiLayer,
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function build(w = 800, h = 600): FlightHud {
  const uiLayer = new Container();
  const renderer = makeRenderer(uiLayer, w, h);
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
  return new FlightHud(renderer, gameEngine, uiLayer);
}

function cornerStack(hud: FlightHud): {
  menuY: number;
  miniLogY: number;
} {
  const h = hud as unknown as {
    menuButtonText: Text | null;
    miniLogContainer: Container | null;
  };
  if (!h.menuButtonText || !h.miniLogContainer)
    throw new Error("bottom-left corner stack not fully built");
  return {
    menuY: h.menuButtonText.y,
    miniLogY: h.miniLogContainer.y,
  };
}

describe("FlightHud — bottom-left corner stack ([МЕНЮ] / mini-log)", () => {
  it("[МЕНЮ] anchors the true bottom-left corner with the mini-log stacked ABOVE it", () => {
    const hud = build(800, 600);
    hud.initialize();
    const { menuY, miniLogY } = cornerStack(hud);

    expect(miniLogY).toBeLessThan(menuY);
    expect(menuY).toBe(600 - 40);

    hud.destroy();
  });

  it("reposition to a new viewport keeps the same stacking order and corner anchor", () => {
    const hud = build(800, 600);
    hud.initialize();

    hud.reposition(1280, 900);
    const { menuY, miniLogY } = cornerStack(hud);

    expect(miniLogY).toBeLessThan(menuY);
    expect(menuY).toBe(900 - 40);

    hud.destroy();
  });
});
