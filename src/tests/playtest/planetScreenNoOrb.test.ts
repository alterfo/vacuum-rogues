import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType } from "@/types";
// Resolves to the headless pixiStub (Graphics/Sprite) via the vi.mock below.
import { Graphics, Sprite } from "pixi.js";

/**
 * Regression (real-engine playtest tier): the planet screen must NOT draw the
 * floating central planet **orb** nor the concentric faction-coloured
 * **atmospheric-glow** rings. Both read as ghost planets over the surface
 * backdrop and the user asked for them gone — only the backdrop + planet
 * name/info/services menu should remain.
 *
 * This boots the real engine into `PlanetScene` (PixiJS stubbed) and inspects
 * the scene graph. Headlessly no texture is loaded, so production's orb renders
 * via its *procedural fallback* (`Graphics` concentric discs up to
 * `PLANET_VISUAL_RADIUS`) and the glow rings are `Graphics` discs at
 * `PLANET_VISUAL_RADIUS + 22/40/60` — every one a large `Graphics.circle`. We
 * spy on `Graphics.circle` to catch them: a clean planet screen draws no large
 * (radius ≥ 100) disc at all (the only remaining circles are the r=5 banner/rep
 * dots). RED until the orb + glow are removed from `PlanetScene.createUI`.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** Mirrors the private `PLANET_VISUAL_RADIUS` in PlanetScene. */
const PLANET_VISUAL_RADIUS = 196;
const ORB_DIAMETER = PLANET_VISUAL_RADIUS * 2;
/** A disc this big is the orb body or one of its halo rings — never a UI dot. */
const LARGE_DISC_RADIUS = 100;

/** Depth-first walk of a display object's subtree (stub `children` arrays). */
function walk(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  const kids = (node as { children?: unknown[] }).children;
  if (Array.isArray(kids)) for (const k of kids) walk(k, out);
  return out;
}

/** Every non-empty `Text.text` string reachable from the given roots. */
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
  /** Radii passed to every `Graphics.circle` after the spy is armed. */
  const circleRadii: number[] = [];
  let circleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
    // Arm the circle spy only after boot so the main-menu draws don't count.
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
    // Given a fresh game parked over a system that has a planet to land on.
    await harness.newGame();
    const system = harness.galaxy()!.systems.find((s) => s.planets.length > 0)!;
    expect(system).toBeDefined();
    const planet = system.planets[0];
    harness.player()!.currentSystemId = system.id;

    // When the player lands on the planet (real scene transition).
    circleRadii.length = 0; // count only what the planet screen draws
    await harness.goTo(SceneType.PLANET, { planet });
    expect(harness.currentSceneType()).toBe(SceneType.PLANET);

    const renderer = harness.engine.renderer!;
    const gameNodes = walk(renderer.gameLayer);

    // Then NO large faction-glow ring or orb-body disc is drawn. The orb's
    // procedural fallback (concentric discs up to PLANET_VISUAL_RADIUS) and the
    // three glow rings (PLANET_VISUAL_RADIUS + 22/40/60) are the only large
    // circles the planet screen ever drew — a clean screen draws none.
    const largeDiscs = circleRadii.filter((r) => r >= LARGE_DISC_RADIUS);
    expect(largeDiscs).toEqual([]);

    // And NO planet-orb sprite (the `planets` disc, sized PLANET_VISUAL_RADIUS*2)
    // is mounted on the game layer (covers the art-backed render path).
    const orbSprites = gameNodes.filter(
      (n) => n instanceof Sprite && (n as Sprite).width === ORB_DIAMETER,
    );
    expect(orbSprites).toEqual([]);

    // But the backdrop layer is intact (the surface gradient/panorama + the dark
    // readability overlay both remain) …
    expect(renderer.gameLayer.children.length).toBeGreaterThanOrEqual(2);

    // … and the planet name + services menu are still present on the UI layer.
    const uiTexts = textsUnder(renderer.uiLayer);
    expect(uiTexts).toContain(planet.name);
    expect(uiTexts.some((t) => t.includes("Взлёт"))).toBe(true);

    // And the whole flow logged/threw nothing.
    expect(harness.errors()).toEqual([]);
  });
});
