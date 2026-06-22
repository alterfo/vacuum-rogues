/**
 * Task 4 (beta-feedback): the in-flight system menu's «Сообщить отзыв» entry
 * captures LIVE context (current scene, in-game day, galaxy seed) and opens the
 * prefilled GitHub Issue Form. {@link wireFlightSystemMenu} accepts an injectable
 * opener so we assert the exact URL handed to it — without a real `window`.
 *
 * Built against a REAL PixiJS scene graph (mirrors inFlightMenuActions.test.ts)
 * so the button is driven through a real pointerdown, not by poking internals.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { Container, Text } from "pixi.js";

import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FlightHud } from "@/presentation/flight/FlightHud";
import { wireFlightSystemMenu } from "@/presentation/flight/flightSystemMenu";
import { buildFeedbackUrl } from "@/systems/feedback/feedbackLink";
import { buildInfo } from "@/systems/feedback/buildInfo";
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

/** Find the UiButton container whose label matches and emit a real pointerdown. */
function clickLabel(uiLayer: Container, label: string): void {
  const labelNode = allTexts(uiLayer).find((t) => t.text === label);
  if (!labelNode) throw new Error(`No button labelled "${label}"`);
  let node: Container | null = labelNode;
  while (node && node.eventMode !== "static") node = node.parent;
  if (!node) throw new Error(`No clickable ancestor for "${label}"`);
  node.emit("pointerdown", { stopPropagation: () => {} } as never);
}

describe("FlightHud — in-flight «Сообщить отзыв»", () => {
  it("renders the feedback button in the system menu", () => {
    const uiLayer = new Container();
    const gameEngine = {
      galaxy: { gameDays: 0, id: "galaxy_SR_1" },
      currentSceneType: SceneType.SPACE_FLIGHT,
      audio: { playUiClick: () => {} },
    } as unknown as GameEngine;
    const hud = new FlightHud(makeRenderer(uiLayer), gameEngine, uiLayer);
    hud.initialize();
    wireFlightSystemMenu(hud, gameEngine, vi.fn());

    hud.toggleSystemMenu();
    expect(hasLabel(uiLayer, "Сообщить отзыв")).toBe(true);

    hud.destroy();
  });

  it("opens the prefilled Issue Form URL carrying live scene/day/seed once", () => {
    const uiLayer = new Container();
    const gameEngine = {
      galaxy: { gameDays: 7, id: "galaxy_SR_999" },
      currentSceneType: SceneType.SPACE_FLIGHT,
      audio: { playUiClick: () => {} },
    } as unknown as GameEngine;
    const hud = new FlightHud(makeRenderer(uiLayer), gameEngine, uiLayer);
    hud.initialize();

    const open = vi.fn();
    wireFlightSystemMenu(hud, gameEngine, open);

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Сообщить отзыв");

    const { version, sha } = buildInfo();
    const expectedUrl = buildFeedbackUrl({
      version,
      sha,
      scene: SceneType.SPACE_FLIGHT,
      day: 7,
      seed: "galaxy_SR_999",
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expectedUrl, "_blank", "noopener");
    // The seed and day are the *live* values, not placeholders.
    const [url] = open.mock.calls[0] as [string];
    const diag = new URL(url).searchParams.get("diagnostics") ?? "";
    expect(diag).toContain("day: 7");
    expect(diag).toContain("seed: galaxy_SR_999");

    hud.destroy();
  });

  it("falls back to safe defaults when no galaxy/engine context exists", () => {
    const uiLayer = new Container();
    const hud = new FlightHud(makeRenderer(uiLayer), null, uiLayer);
    hud.initialize();

    const open = vi.fn();
    wireFlightSystemMenu(hud, null, open);

    hud.toggleSystemMenu();
    clickLabel(uiLayer, "Сообщить отзыв");

    expect(open).toHaveBeenCalledTimes(1);
    const [url, target, features] = open.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener");
    const diag = new URL(url).searchParams.get("diagnostics") ?? "";
    expect(diag).toContain(`scene: ${SceneType.SPACE_FLIGHT}`);
    expect(diag).toContain("day: 0");
    expect(diag).toContain("seed: —");

    hud.destroy();
  });
});
