/**
 * Task 2 — Captured-system landing gate (docs/plans/20260620-captured-system-
 * landing-gating.md). The pure predicate `canLandOnPlanet` (Task 1) is wired
 * into the landing flow via `PlanetManager.landingDenial`, consulted by the
 * single choke point every landing path funnels through —
 * `SpaceFlightScene.onLandOnPlanet` (info-panel land button, mid-flight
 * auto-land, arrival land).
 *
 * Two layers are covered here:
 *  - `PlanetManager.landingDenial` — the real access decision: overmind-captured
 *    → "overmind"; pirate-captured → "pirate-rep" below the threshold, allowed
 *    at/above; uncaptured → allowed.
 *  - `SpaceFlightScene.onLandOnPlanet` — the wiring: a denial blocks the PLANET
 *    transition, shows a clear message and clears the route (so the ship isn't
 *    stranded); no denial transitions as before.
 * The predicate's own boundary cases live in galaxy/landingAccess.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

// Mock pixi.js + the presentation helpers SpaceFlightScene / PlanetManager import
// at load so the modules resolve in jsdom without a real WebGL context (mirrors
// the pixi mock block in waitTurnPause.test.ts). We never construct the scene —
// the real methods are invoked off their prototypes against minimal `this`es.
vi.mock("pixi.js", () => {
  const makeContainer = () => ({
    addChild: vi.fn(),
    addChildAt: vi.fn(),
    removeChild: vi.fn(),
    children: [],
    eventMode: "auto",
    cursor: "pointer",
    sortableChildren: false,
    x: 0,
    y: 0,
    alpha: 1,
    zIndex: 0,
    scale: { set: vi.fn() },
    filters: [],
    hitArea: null,
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  });
  return {
    Container: vi.fn().mockImplementation(makeContainer),
    Graphics: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      ellipse: vi.fn().mockReturnThis(),
      stroke: vi.fn().mockReturnThis(),
      poly: vi.fn().mockReturnThis(),
      moveTo: vi.fn().mockReturnThis(),
      lineTo: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
      mask: null,
    })),
    Text: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      text: "",
      style: { fill: 0, fontFamily: "", fontSize: 12 },
      width: 100,
      height: 20,
    })),
    Sprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      anchor: { set: vi.fn() },
      width: 0,
      height: 0,
      tint: 0xffffff,
      mask: null,
      texture: {},
    })),
    TilingSprite: vi.fn().mockImplementation(() => ({
      ...makeContainer(),
      tileScale: { set: vi.fn() },
      tilePosition: { x: 0, y: 0 },
      tint: 0xffffff,
      mask: null,
    })),
    BlurFilter: vi.fn().mockImplementation(() => ({
      strength: 0,
      padding: 0,
      resolution: 1,
    })),
    Circle: vi.fn().mockImplementation((x: number, y: number, r: number) => ({
      x,
      y,
      radius: r,
    })),
  };
});

vi.mock("@/presentation/sphereMesh", () => ({
  buildSphereMesh: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/PlanetSprite", () => ({
  PlanetSprite: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/presentation/PlanetInfoPanel", () => ({
  PlanetInfoPanel: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/SystemMiniMap", () => ({
  SystemMiniMap: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/QuestJournalUI", () => ({
  QuestJournalUI: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/NpcShipSprite", () => ({
  NpcShipSprite: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/presentation/NpcContactPanel", () => ({
  NpcContactPanel: vi.fn().mockImplementation(() => ({ destroy: vi.fn() })),
}));
vi.mock("@/presentation/textures", () => ({
  pickVariant: vi.fn().mockReturnValue(null),
  pickVariantKey: vi.fn().mockReturnValue(null),
  loadTextureAsync: vi.fn().mockResolvedValue(null),
  tex: vi.fn().mockReturnValue(null),
}));
vi.mock("@/presentation/cursor", () => ({
  installGameCursors: vi.fn(),
  setCanvasCursor: vi.fn(),
}));

import { SpaceFlightScene } from "@/presentation/SpaceFlightScene";
import { PlanetManager } from "@/presentation/flight/PlanetManager";
import {
  landingDenialMessage,
  PIRATE_FACTION_ID,
  type LandingDenialReason,
} from "@/systems/galaxy/landingAccess";
import { GOOD_PIRATE_REP_THRESHOLD } from "@/config/balance";
import { Faction } from "@/types/faction";

type Captured = { capturedBy: string | null };

// ---------------------------------------------------------------------------
// PlanetManager.landingDenial — the real access decision (no planet sprites
// needed; it reads only gameEngine.player + planet.capturedBy).
// ---------------------------------------------------------------------------

const landingDenial = (
  PlanetManager.prototype as unknown as {
    landingDenial(p: Captured): LandingDenialReason | null;
  }
).landingDenial;

function denialFor(capturedBy: string | null, rep: number) {
  const self = { gameEngine: { player: { getReputation: () => rep } } };
  return landingDenial.call(self, { capturedBy });
}

describe("PlanetManager.landingDenial (captured-system access)", () => {
  it("never lets the player land on an Overmind-captured planet", () => {
    expect(denialFor(Faction.OVERMIND, 100)).toBe("overmind");
  });

  it("blocks a pirate-captured planet below the rep threshold", () => {
    expect(denialFor(PIRATE_FACTION_ID, GOOD_PIRATE_REP_THRESHOLD - 1)).toBe(
      "pirate-rep",
    );
  });

  it("allows a pirate-captured planet at/above the rep threshold", () => {
    expect(denialFor(PIRATE_FACTION_ID, GOOD_PIRATE_REP_THRESHOLD)).toBeNull();
  });

  it("allows an uncaptured planet", () => {
    expect(denialFor(null, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SpaceFlightScene.onLandOnPlanet — the wiring: consult landingDenial, then
// block (no transition + message + route cleared) or land (transition).
// ---------------------------------------------------------------------------

type LandFn = (planet: unknown) => Promise<void>;
const onLandOnPlanet = (
  SpaceFlightScene.prototype as unknown as { onLandOnPlanet: LandFn }
).onLandOnPlanet;

/** A minimal scene `this` carrying only the fields `onLandOnPlanet` touches. */
function makeScene(denial: LandingDenialReason | null) {
  const transitionTo = vi.fn().mockResolvedValue(undefined);
  const showMessage = vi.fn();
  const clearPlannedRoute = vi.fn();
  const scene = {
    gameEngine: {
      player: { ship: { energy: 0, maxEnergy: 100 } },
      transitionTo,
    },
    hud: { showMessage },
    planetManager: {
      landingDenial: vi.fn().mockReturnValue(denial),
      // ship has no physics in this harness, so shipReachedPlanet is never hit.
      shipReachedPlanet: vi.fn().mockReturnValue(true),
    },
    shipPhysics: null,
    clearPlannedRoute,
  };
  return { scene, transitionTo, showMessage, clearPlannedRoute };
}

const land = (scene: unknown, planet: Captured) =>
  onLandOnPlanet.call(scene, planet);

describe("SpaceFlightScene.onLandOnPlanet (captured-system gate wiring)", () => {
  it("blocks a denied landing: no PLANET transition, clear message, route cleared", async () => {
    const { scene, transitionTo, showMessage, clearPlannedRoute } =
      makeScene("overmind");
    await land(scene, { capturedBy: Faction.OVERMIND });

    expect(transitionTo).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(
      landingDenialMessage("overmind"),
      expect.any(Number),
    );
    // Route cleared so the auto-land can't re-fire and the player isn't stranded.
    expect(clearPlannedRoute).toHaveBeenCalled();
  });

  it("surfaces the pirate-rep reason when that is the denial", async () => {
    const { scene, transitionTo, showMessage } = makeScene("pirate-rep");
    await land(scene, { capturedBy: PIRATE_FACTION_ID });

    expect(transitionTo).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(
      landingDenialMessage("pirate-rep"),
      expect.any(Number),
    );
  });

  it("lands normally when there is no denial (unchanged behaviour)", async () => {
    const { scene, transitionTo, showMessage } = makeScene(null);
    await land(scene, { capturedBy: null });

    expect(transitionTo).toHaveBeenCalledTimes(1);
    expect(showMessage).not.toHaveBeenCalled();
  });
});
