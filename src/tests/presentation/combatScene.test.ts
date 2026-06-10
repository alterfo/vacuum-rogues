import { describe, it, expect, vi, beforeEach } from "vitest";
import { CombatScene } from "@/presentation/CombatScene";
import { Container, Graphics, Sprite } from "pixi.js";
import { pickVariant } from "@/presentation/textures";
import type { TacticalEncounter } from "@/domain/TacticalEncounter";

vi.mock("pixi.js", () => ({
  Container: vi.fn().mockImplementation(() => ({
    addChild: vi.fn(),
    destroy: vi.fn(),
    children: [],
    on: vi.fn(),
    x: 0,
    y: 0,
    visible: true,
    eventMode: "auto",
    cursor: "default",
  })),
  Graphics: vi.fn().mockImplementation(() => ({
    rect: vi.fn().mockReturnThis(),
    roundRect: vi.fn().mockReturnThis(),
    circle: vi.fn().mockReturnThis(),
    poly: vi.fn().mockReturnThis(),
    fill: vi.fn().mockReturnThis(),
    stroke: vi.fn().mockReturnThis(),
    clear: vi.fn().mockReturnThis(),
    on: vi.fn(),
    addChild: vi.fn(),
    x: 0,
    y: 0,
    alpha: 1,
    eventMode: "auto",
    cursor: "default",
  })),
  Sprite: vi.fn().mockImplementation(() => ({
    anchor: { set: vi.fn() },
    width: 0,
    height: 0,
    tint: 0xffffff,
    rotation: 0,
    eventMode: "auto",
  })),
  Text: vi.fn().mockImplementation((opts?: { text?: string }) => ({
    text: opts?.text ?? "",
    x: 0,
    y: 0,
    width: 50,
    height: 14,
    style: {},
    anchor: { set: vi.fn() },
    eventMode: "auto",
    on: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn(),
}));

// Grid geometry mirrored from CombatScene (HEX_SIZE 24, 9×9, 1.8/0.9/1.5
// spacing factors) — a regression guard against hardcoded pixel offsets.
const HEX = 24;
const SPAN_X = 8 * HEX * 1.8 + HEX * 0.9;
const SPAN_Y = 8 * HEX * 1.5;

/**
 * Vertical offset mirrored from CombatScene.gridOffset(): centred, but clamped
 * so the bottom hex row stays above the action-button row (0.78·screenH) and
 * the top row stays below the title/HP bars (80px).
 */
function expectedGridY(screenH: number): number {
  const maxY = Math.round(screenH * 0.78) - SPAN_Y - HEX - 8;
  const centred = Math.round((screenH - SPAN_Y) / 2);
  return Math.max(80, Math.min(centred, maxY));
}

function makeRenderer(width: number, height: number) {
  return {
    app: { screen: { width, height } },
    uiLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    gameLayer: { addChild: vi.fn(), removeChild: vi.fn(), children: [] },
    clearGameLayer: vi.fn(),
    clearUILayer: vi.fn(),
  } as unknown as import("@/presentation/Renderer").Renderer;
}

function makeEncounter(): TacticalEncounter {
  return {
    playerShip: { hullHP: 100, maxHull: 100, shields: 0 },
    enemies: [
      { id: "enemy_a", hullHP: 60, maxHull: 60 },
      { id: "enemy_b", hullHP: 60, maxHull: 60 },
    ],
    state: "ACTIVE",
  } as unknown as TacticalEncounter;
}

function gameLayerChildren(
  renderer: import("@/presentation/Renderer").Renderer,
): { x: number; y: number }[] {
  return (
    renderer.gameLayer.addChild as ReturnType<typeof vi.fn>
  ).mock.calls.map((c) => c[0] as { x: number; y: number });
}

describe("CombatScene — layout polish (F5)", () => {
  beforeEach(() => {
    // Clears calls/results on ALL constructor mocks (Container, Graphics,
    // Sprite, Text, pickVariant) — partial resets let Graphics state leak
    // across tests and made call-count assertions order-dependent.
    vi.clearAllMocks();
  });

  it("centres the hex grid container for a 1280×800 screen", () => {
    (pickVariant as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const renderer = makeRenderer(1280, 800);
    const scene = new CombatScene(renderer);
    scene.initialize({ encounter: makeEncounter() });

    const [grid] = gameLayerChildren(renderer);
    expect(grid).toBeDefined();
    expect(grid.x).toBe(Math.round((1280 - SPAN_X) / 2));
    // Tall enough screen → pure centring (clamp is not in play).
    expect(grid.y).toBe(Math.round((800 - SPAN_Y) / 2));
    expect(grid.y).toBe(expectedGridY(800));

    scene.destroy();
  });

  it("derives the grid offset from the screen size, not hardcoded pixels", () => {
    (pickVariant as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const renderer = makeRenderer(1000, 600);
    const scene = new CombatScene(renderer);
    scene.initialize({ encounter: makeEncounter() });

    const [grid] = gameLayerChildren(renderer);
    expect(grid.x).toBe(Math.round((1000 - SPAN_X) / 2));
    expect(grid.y).toBe(expectedGridY(600));

    scene.destroy();
  });

  it("keeps the bottom hex row clear of the action-button row on short screens", () => {
    (pickVariant as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const renderer = makeRenderer(1000, 600);
    const scene = new CombatScene(renderer);
    scene.initialize({ encounter: makeEncounter() });

    const [grid] = gameLayerChildren(renderer);
    // Centred placement would put the bottom hex edge exactly on the button
    // row (156 + 288 + 24 = 468 = 0.78·600); the clamp must pull it up.
    expect(grid.y + SPAN_Y + HEX).toBeLessThan(Math.round(600 * 0.78));
    expect(grid.y).toBeGreaterThanOrEqual(80); // and below the title/HP bars

    scene.destroy();
  });

  it("parents all unit tokens to the centred grid container, not the gameLayer", () => {
    (pickVariant as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const renderer = makeRenderer(1280, 800);
    const scene = new CombatScene(renderer);
    scene.initialize({ encounter: makeEncounter() });

    // Only the grid container itself lands on the gameLayer…
    expect(
      (renderer.gameLayer.addChild as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
    // …and it receives the hex graphics + player token + 2 enemy tokens.
    const grid = (Container as unknown as ReturnType<typeof vi.fn>).mock
      .results[0].value as { addChild: ReturnType<typeof vi.fn> };
    expect(grid.addChild.mock.calls).toHaveLength(4);

    scene.destroy();
  });

  it("renders units as tinted ship sprites when textures are available", () => {
    const fakeTexture = { label: "ships/test" };
    (pickVariant as ReturnType<typeof vi.fn>).mockReturnValue(fakeTexture);
    const renderer = makeRenderer(1280, 800);
    const scene = new CombatScene(renderer);
    scene.initialize({ encounter: makeEncounter() });

    // player ship + 2 enemies = 3 sprites
    const spriteMock = Sprite as unknown as ReturnType<typeof vi.fn>;
    expect(spriteMock).toHaveBeenCalledTimes(3);
    expect(spriteMock).toHaveBeenCalledWith(fakeTexture);

    // player uses ranger hull, enemies use pirate hulls
    const prefixes = (pickVariant as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[1] as string,
    );
    expect(prefixes).toContain("ranger");
    expect(prefixes.filter((p) => p === "pirate")).toHaveLength(2);

    // each sprite carries a faction tint (not left default white)
    for (const result of spriteMock.mock.results) {
      const sp = result.value as { tint: number };
      expect(sp.tint).not.toBe(0xffffff);
    }

    scene.destroy();
  });

  it("falls back to circle tokens when ship textures are missing", () => {
    (pickVariant as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const renderer = makeRenderer(1280, 800);
    const scene = new CombatScene(renderer);
    scene.initialize({ encounter: makeEncounter() });

    expect(
      Sprite as unknown as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();

    // Fallback tokens draw exactly 2 circle() calls each (fill + stroke ring)
    // for the player + 2 enemies; nothing else in the scene draws circles.
    const graphicsMock = Graphics as unknown as ReturnType<typeof vi.fn>;
    const circleCalls = graphicsMock.mock.results
      .map((r) => r.value as { circle: ReturnType<typeof vi.fn> })
      .reduce((n, g) => n + g.circle.mock.calls.length, 0);
    expect(circleCalls).toBe(6);

    scene.destroy();
  });
});
