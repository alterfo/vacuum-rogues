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

function stubTouchEnv(): void {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("coarse"),
  }));
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
}

function makeRenderer(uiLayer: Container, w = 800, h = 600): Renderer {
  return {
    app: { screen: { width: w, height: h } },
    stage: new Container(),
    uiLayer,
    gameLayer: new Container(),
  } as unknown as Renderer;
}

function build(w = 800, h = 600): { hud: FlightHud; uiLayer: Container } {
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

  it("on a narrow phone the ✕/ХОД pair shifts right of the bottom-left [МЕНЮ] lane instead of overlapping it", () => {
    stubTouchEnv();
    const { hud, uiLayer } = build(390, 844);
    hud.initialize();
    const buttonX = (label: string): number => {
      const text = allTexts(uiLayer).find((t) => t.text === label);
      if (!text) throw new Error(`No "${label}" button`);
      let node: Container | null = text;
      while (node && node.eventMode !== "static") node = node.parent;
      if (!node) throw new Error(`No clickable ancestor for "${label}"`);
      return node.x;
    };
    expect(buttonX("✕")).toBeGreaterThanOrEqual(104);
    expect(buttonX("▶ ХОД")).toBe(buttonX("✕") + 64);
    hud.reposition(390, 844);
    expect(buttonX("✕")).toBeGreaterThanOrEqual(104);
    hud.reposition(800, 600);
    expect(buttonX("✕")).toBe(800 / 2 - 134);
    hud.destroy();
  });

  it("survives a font-scale restyle exactly once (no duplicate leak)", () => {
    stubTouchEnv();
    const { hud, uiLayer } = build();
    hud.initialize();
    hud.refreshFontScale();
    expect(allTexts(uiLayer).filter((t) => t.text === "✕").length).toBe(1);
    hud.destroy();
  });
});
