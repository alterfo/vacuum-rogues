/**
 * Playtest bug pass 2, Task 4 — "the palette change does nothing".
 *
 * The accessibility ПАЛИТРА control persists a new palette mode, but the only
 * place it was reachable (the in-flight ♿ panel) never re-applied it to the
 * already-rendered scene: an NPC ship hull reads {@link factionColor} once when
 * its graphic is built, so the live ships kept their old colour until the scene
 * was rebuilt. These pin the live-recolor seam that closes that gap:
 *   • `NpcShipSprite.refreshPaletteColors()` re-reads `factionColor` (hull +
 *     minimap `mapColor`) under the *current* palette mode, and
 *   • the seam itself flows: `factionColor` returns a different hue once the
 *     mode is switched through the accessor.
 *
 * RED before the fix: `refreshPaletteColors` did not exist and `mapColor` was a
 * one-shot `readonly`, so a palette switch left the sprite's colour stale.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Container } from "pixi.js";
import { NpcShipSprite, type SystemBounds } from "@/presentation/NpcShipSprite";
import {
  NpcShipManager,
  type NpcShipManagerDeps,
} from "@/presentation/flight/NpcShipManager";
import { ShipPhysics } from "@/systems/ShipPhysics";
import { NpcShip } from "@/domain/NpcShip";
import { NpcRole, NpcState, FactionType } from "@/types";
import { Faction } from "@/types/faction";
import type { Renderer } from "@/presentation/Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Galaxy } from "@/domain/Galaxy";
import {
  factionColor,
  setPaletteMode,
  PALETTE_MODE_KEY,
} from "@/presentation/ui/palette";

const bounds: SystemBounds = {
  cx: 0,
  cy: 0,
  rInner: 100,
  rOuter: 500,
  boundary: 800,
};

function makeNpc(faction: Faction): NpcShip {
  return new NpcShip({
    id: "npc_recolor",
    name: "Recolor",
    race: FactionType.SYNDICATE,
    faction,
    role: NpcRole.TRADER,
    hullHP: 100,
    maxHull: 100,
    shields: 40,
    speed: 0.1,
    damage: 20,
    currentSystemId: "sys_a",
    state: NpcState.PATROLLING,
    goal: null,
    destinationSystemId: null,
    daysToArrival: 0,
    credits: 0,
    reputation: 0,
  });
}

describe("NpcShipSprite palette live-recolor (Task 4 — palette actually applies)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("the faction-colour seam responds to a palette switch (default ≠ dichromat)", () => {
    const def = factionColor(Faction.SYNDICATE, "default");
    const deut = factionColor(Faction.SYNDICATE, "deuteranopia");
    expect(deut).not.toBe(def);
  });

  it("refreshPaletteColors re-reads factionColor under the current mode", () => {
    const sprite = new NpcShipSprite(makeNpc(Faction.SYNDICATE), 0, 0, bounds);
    // Built under the default palette.
    expect(sprite.mapColor).toBe(factionColor(Faction.SYNDICATE, "default"));

    // Switch the palette through the same accessor the ♿ panel writes.
    setPaletteMode("deuteranopia");
    expect(localStorage.getItem(PALETTE_MODE_KEY)).toBe("deuteranopia");

    // Live re-apply: the sprite adopts the new mode's hue (no scene rebuild).
    sprite.refreshPaletteColors();
    expect(sprite.mapColor).toBe(
      factionColor(Faction.SYNDICATE, "deuteranopia"),
    );
    expect(sprite.mapColor).not.toBe(
      factionColor(Faction.SYNDICATE, "default"),
    );
  });
});

// The leaf seam above is what the player reported broken IN FLIGHT, but the scene
// reaches it through `NpcShipManager.refreshFactionColors()` (wired to the ♿/
// settings ПАЛИТРА control via `FlightHud.onPaletteChange`). Pin that loop so an
// unwiring of the manager fan-out — not just the leaf — is caught.
describe("NpcShipManager.refreshFactionColors fans the live recolor to every ship", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function renderer(): Renderer {
    return {
      app: { screen: { width: 800, height: 600 } },
      stage: new Container(),
      uiLayer: new Container(),
      gameLayer: new Container(),
    } as unknown as Renderer;
  }

  function managerNpc(id: string, faction: Faction): NpcShip {
    return new NpcShip({
      id,
      name: id,
      race: FactionType.SYNDICATE,
      faction,
      role: NpcRole.TRADER,
      hullHP: 100,
      maxHull: 100,
      shields: 0,
      speed: 0.1,
      damage: 10,
      currentSystemId: "sys_a",
      state: NpcState.PATROLLING,
      goal: null,
      destinationSystemId: null,
      daysToArrival: 0,
      credits: 0,
      reputation: 0,
    });
  }

  it("recolours every live NPC sprite when the palette switches", () => {
    const physics = new ShipPhysics(0, 0, 0.3);
    const galaxy = {
      npcShips: [
        managerNpc("a", Faction.SYNDICATE),
        managerNpc("b", Faction.INDEPENDENT),
      ],
      isHostileSystem: () => false,
    } as unknown as Galaxy;
    const deps: NpcShipManagerDeps = {
      getShipPhysics: () => physics,
      getPlanetSprites: () => [],
      getStarCenter: () => ({ x: 400, y: 300 }),
      isTurnRunning: () => false,
      showMessage: () => {},
      showTooltip: () => {},
      hideTooltip: () => {},
      executeRouteTo: () => {},
      clearRouteTarget: () => {},
      endTurn: () => {},
    };
    const manager = new NpcShipManager(
      renderer(),
      { galaxy, player: { currentSystemId: "sys_a" } } as unknown as GameEngine,
      new Container(),
      new Container(),
      deps,
    );
    manager.initialize();
    const sprites = (manager as unknown as { npcSprites: NpcShipSprite[] })
      .npcSprites;
    expect(sprites.length).toBe(2);
    for (const s of sprites) {
      expect(s.mapColor).toBe(factionColor(s.npc.faction, "default"));
    }

    setPaletteMode("deuteranopia");
    manager.refreshFactionColors();

    for (const s of sprites) {
      expect(s.mapColor).toBe(factionColor(s.npc.faction, "deuteranopia"));
    }

    manager.destroy();
  });
});
