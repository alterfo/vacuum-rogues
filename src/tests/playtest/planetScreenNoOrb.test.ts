import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
import { Graphics, Sprite } from "pixi.js";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const PLANET_VISUAL_RADIUS = 196;
const ORB_DIAMETER = PLANET_VISUAL_RADIUS * 2;
const LARGE_DISC_RADIUS = 100;

function walk(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  const kids = (node as { children?: unknown[] }).children;
  if (Array.isArray(kids)) for (const k of kids) walk(k, out);
  return out;
}

function textsUnder(...roots: unknown[]): string[] {
  const texts: string[] = [];
  for (const root of roots) {
    for (const n of walk(root)) {
      const t = (n as { text?: unknown }).text;
      if (typeof t === "string" && t.length > 0) texts.push(t);
    }
  }
  return texts;
}

describe("Planet screen: no central orb or atmospheric-glow rings", () => {
  let harness: RealEngineHarness;
  const circleRadii: number[] = [];
  let circleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    circleRadii.length = 0;
    circleSpy = vi
      .spyOn(
        Graphics.prototype as unknown as { circle: () => unknown },
        "circle",
      )
      .mockImplementation(function (this: unknown, ..._args: unknown[]) {
        circleRadii.push(Number(_args[2]));
        return this;
      });
  });

  afterEach(() => {
    circleSpy?.mockRestore();
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders backdrop + name + services menu but no orb sprite or glow discs", async () => {
    await harness.newGame();
    const system = harness.galaxy()!.systems.find((s) => s.planets.length > 0)!;
    expect(system).toBeDefined();
    const planet = system.planets[0];
    harness.player()!.currentSystemId = system.id;

    circleRadii.length = 0; // count only what the planet screen draws
    await harness.goTo(SceneType.PLANET, { planet });
    expect(harness.currentSceneType()).toBe(SceneType.PLANET);

    const renderer = harness.engine.renderer!;
    const gameNodes = walk(renderer.gameLayer);

    const largeDiscs = circleRadii.filter((r) => r >= LARGE_DISC_RADIUS);
    expect(largeDiscs).toEqual([]);

    const orbSprites = gameNodes.filter(
      (n) => n instanceof Sprite && (n as Sprite).width === ORB_DIAMETER,
    );
    expect(orbSprites).toEqual([]);

    expect(renderer.gameLayer.children.length).toBeGreaterThanOrEqual(2);

    const uiTexts = textsUnder(renderer.uiLayer);
    expect(uiTexts).toContain(planet.name);
    expect(uiTexts.some((t) => t.includes("Взлёт"))).toBe(true);

    expect(harness.errors()).toEqual([]);
  });
});
