/**
 * Task 3 (in-flight system menu gating): the always-available escape menu must
 * not offer a dead «Загрузить сохранение» button. This proves the gating:
 * - no save → the action is dimmed/inert with a "Нет сохранения" hint and never
 *   fires onLoadSave;
 * - save present → the action is live and fires onLoadSave;
 * - the menu opens regardless of turn state (it is a general escape hatch, not
 *   gated on the turn/engine-stall — the low-hull dead-end must stay reachable);
 * - wired through {@link wireFlightSystemMenu}, the async `saveManager.hasSave()`
 *   probe flips the action on/off as the scene does it.
 *
 * Built against a REAL PixiJS scene graph (mirrors inFlightMenu*.test.ts).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Container, Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { wireFlightSystemMenu } from "@/presentation/flight/flightSystemMenu";
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
  hud.initialize();
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

/** Drain the microtask + macrotask queue so a fire-and-forget probe settles. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Click the menu action labelled `label`: walk up from its label Text to the
 * nearest eventMode='static' ancestor and emit a real pointerdown. A dimmed
 * (disabled) button has eventMode='none', so the walk stops at the panel and the
 * action never fires — exactly the production behaviour.
 */
function clickLabel(uiLayer: Container, label: string): void {
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No button labelled "${label}"`);
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", { stopPropagation: () => {} } as never);
}

describe("FlightHud — in-flight system menu gating", () => {
  it("offers «Загрузить сохранение» as a live action when a save exists", () => {
    const { hud, uiLayer } = build();
    hud.setLoadSaveEnabled(true);

    let loadCalls = 0;
    hud.onLoadSave = () => loadCalls++;

    hud.toggleSystemMenu();
    expect(hud.isLoadSaveEnabled()).toBe(true);
    expect(hasLabel(uiLayer, "Загрузить сохранение")).toBe(true);
    expect(hasLabel(uiLayer, "Нет сохранения")).toBe(false);

    clickLabel(uiLayer, "Загрузить сохранение");
    expect(loadCalls).toBe(1);

    hud.destroy();
  });

  it("dims «Загрузить сохранение» with a hint and ignores clicks when no save exists", () => {
    const { hud, uiLayer } = build();
    hud.setLoadSaveEnabled(false);

    let loadCalls = 0;
    hud.onLoadSave = () => loadCalls++;

    hud.toggleSystemMenu();
    expect(hud.isLoadSaveEnabled()).toBe(false);
    // The button label is still shown (so the player sees the option), but a
    // "no save" hint explains why it is unavailable.
    expect(hasLabel(uiLayer, "Загрузить сохранение")).toBe(true);
    expect(hasLabel(uiLayer, "Нет сохранения")).toBe(true);

    // Clicking the dimmed action must not load anything.
    clickLabel(uiLayer, "Загрузить сохранение");
    expect(loadCalls).toBe(0);

    hud.destroy();
  });

  it("rebuilds a live menu when save availability flips", () => {
    const { hud, uiLayer } = build();
    hud.setLoadSaveEnabled(true);
    hud.toggleSystemMenu();
    expect(hasLabel(uiLayer, "Нет сохранения")).toBe(false);

    // A flip while open swaps the live button for the dimmed hint variant.
    hud.setLoadSaveEnabled(false);
    expect(hud.isSystemMenuOpen()).toBe(true);
    expect(hasLabel(uiLayer, "Нет сохранения")).toBe(true);

    // …and back again.
    hud.setLoadSaveEnabled(true);
    expect(hasLabel(uiLayer, "Нет сохранения")).toBe(false);

    hud.destroy();
  });

  it("opens regardless of turn state — the dead-end stays reachable", () => {
    const { hud } = build();
    // Engines stalled / turn running (the low-hull dead-end is a scene concern;
    // the HUD menu must never be gated on it).
    hud.setTurnRunning(true);

    expect(hud.isSystemMenuOpen()).toBe(false);
    hud.toggleSystemMenu();
    expect(hud.isSystemMenuOpen()).toBe(true);

    hud.destroy();
  });

  it("wireFlightSystemMenu flips the action from the async hasSave() probe", async () => {
    const uiLayer = new Container();
    const renderer = makeRenderer(uiLayer);
    const hasSave = vi.fn(async () => false);
    const gameEngine = {
      galaxy: { gameDays: 0 },
      audio: {
        playUiClick: () => {},
        playUiHover: () => {},
        playToast: () => {},
      },
      questManager: {},
      player: { getReputation: () => 0 },
      saveManager: { hasSave },
    } as unknown as GameEngine;
    const hud = new FlightHud(renderer, gameEngine, uiLayer);
    hud.initialize();

    wireFlightSystemMenu(hud, gameEngine);
    // The seed probe resolves false → the action is gated off.
    await flush();
    expect(hud.isLoadSaveEnabled()).toBe(false);

    // A save appears (take-off autosave); the next open re-probes and enables it.
    hasSave.mockResolvedValue(true);
    hud.toggleSystemMenu();
    await flush();
    expect(hud.isLoadSaveEnabled()).toBe(true);
    expect(hasLabel(uiLayer, "Нет сохранения")).toBe(false);

    hud.destroy();
  });
});
