/**
 * Mobile adaptation Task 3 — the HUD's touch-only «✕» cancel button (the
 * on-screen twin of the Esc key). On a coarse-pointer touch layout the HUD grows
 * a ✕ button left of «ХОД» that fans out via {@link FlightHud.onCancel}; on a
 * fine-pointer desktop it is **never built** (the desktop HUD is unchanged). The
 * scene wires onCancel to the exact action Escape runs (asserted by the
 * flightKeyHandler suite / scene wiring) — here we prove the HUD side: the button
 * appears only on touch and dispatches onCancel via the real pointer path.
 *
 * Built against a REAL PixiJS scene graph in jsdom (mirrors inFlightMenu.test.ts);
 * the touch *device* is faked by stubbing the window pointer/size globals that
 * `isTouchLayoutActive` reads.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Container, Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { setFontScale } from "@/utils/fontScale";

afterEach(() => {
  setFontScale("M");
  vi.unstubAllGlobals(); // never leak the faked touch env into other tests
});

/** Fake a coarse-pointer phone so `isTouchLayoutActive()` reads true. */
function stubTouchEnv(): void {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("coarse"),
  }));
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
}

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
  return { hud: new FlightHud(renderer, gameEngine, uiLayer), uiLayer };
}

function allTexts(node: Container): Text[] {
  const out: Text[] = [];
  if (node instanceof Text) out.push(node);
  for (const child of node.children)
    if (child instanceof Container) out.push(...allTexts(child));
  return out;
}

function clickLabel(uiLayer: Container, label: string): void {
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No button labelled "${label}"`);
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", { stopPropagation: () => {} } as never);
}

describe("FlightHud — touch ✕ cancel button", () => {
  it("builds the ✕ button on a coarse-pointer touch layout", () => {
    stubTouchEnv();
    const { hud, uiLayer } = build();
    hud.initialize();
    expect(allTexts(uiLayer).some((t) => t.text === "✕")).toBe(true);
    hud.destroy();
  });

  it("is NOT built on a fine-pointer desktop (HUD unchanged)", () => {
    // No stub → default jsdom env has no coarse pointer → gate is off.
    const { hud, uiLayer } = build();
    hud.initialize();
    expect(allTexts(uiLayer).some((t) => t.text === "✕")).toBe(false);
    hud.destroy();
  });

  it("dispatches onCancel via the real pointer path", () => {
    stubTouchEnv();
    const { hud, uiLayer } = build();
    hud.initialize();
    let cancels = 0;
    hud.onCancel = () => cancels++;
    clickLabel(uiLayer, "✕");
    expect(cancels).toBe(1);
    hud.destroy();
  });

  it("survives a font-scale restyle exactly once (no duplicate leak)", () => {
    // refreshFontScale tears the HUD down and rebuilds it in place; the ✕ must
    // come back exactly once (teardownUI nulls it, createUI re-gates it).
    stubTouchEnv();
    const { hud, uiLayer } = build();
    hud.initialize();
    hud.refreshFontScale();
    expect(allTexts(uiLayer).filter((t) => t.text === "✕").length).toBe(1);
    hud.destroy();
  });
});
