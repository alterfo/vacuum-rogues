/**
 * HUD bottom-left corner lane (ae8b082): [МЕНЮ] is the true bottom-left corner
 * element, ♿ stacks tight above it, the mini-log sits above both — nothing may
 * render below [МЕНЮ] (an empty mini-log gap under it read as dead space).
 * These pin the vertical stacking ORDER on both the create and reposition
 * paths — a regression that puts the mini-log back under [МЕНЮ] must red here.
 *
 * Built against a REAL PixiJS scene graph in jsdom (mirrors
 * flightHudTouchControls.test.ts); only y-coordinates are read, never text
 * measurement (which throws in jsdom).
 */
import { describe, it, expect } from "vitest";
import { Container, type Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
import type { UiButton } from "@/presentation/ui/UiButton";

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

/** The three bottom-left stack elements, reached via their private fields. */
function cornerStack(hud: FlightHud): {
  menuY: number;
  accY: number;
  miniLogY: number;
} {
  const h = hud as unknown as {
    menuButtonText: Text | null;
    accessibilityButton: UiButton | null;
    miniLogContainer: Container | null;
  };
  if (!h.menuButtonText || !h.accessibilityButton || !h.miniLogContainer)
    throw new Error("bottom-left corner stack not fully built");
  return {
    menuY: h.menuButtonText.y,
    accY: h.accessibilityButton.y,
    miniLogY: h.miniLogContainer.y,
  };
}

describe("FlightHud — bottom-left corner stack ([МЕНЮ] / ♿ / mini-log)", () => {
  it("[МЕНЮ] anchors the true bottom-left corner with ♿ and the mini-log stacked ABOVE it", () => {
    const hud = build(800, 600);
    hud.initialize();
    const { menuY, accY, miniLogY } = cornerStack(hud);

    // Stacking order top→bottom: mini-log, ♿, [МЕНЮ].
    expect(miniLogY).toBeLessThan(accY);
    expect(accY).toBeLessThan(menuY);
    // [МЕНЮ] is the bottom-most (corner) element — nothing of the stack
    // renders below it, and it hugs the bottom edge.
    expect(menuY).toBe(600 - 40);

    hud.destroy();
  });

  it("reposition to a new viewport keeps the same stacking order and corner anchor", () => {
    const hud = build(800, 600);
    hud.initialize();

    hud.reposition(1280, 900);
    const { menuY, accY, miniLogY } = cornerStack(hud);

    expect(miniLogY).toBeLessThan(accY);
    expect(accY).toBeLessThan(menuY);
    expect(menuY).toBe(900 - 40);

    hud.destroy();
  });
});
