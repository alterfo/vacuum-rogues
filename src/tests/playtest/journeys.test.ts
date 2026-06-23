import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, QuestType, ResourceType } from "@/types";
import type { Reward } from "@/types";
import type { QuestTemplate } from "@/core/ports/IQuestService";
import { CombatModule } from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

/**
 * Core-journey behaviour scenarios over the **real** engine (Task 2 of the
 * real-engine playtest harness). Each scenario reads Given-When-Then and drives
 * the genuine wiring — real `GameEngine`, `QuestManager`, `BankingService`,
 * scene transitions and `CombatModule` — only PixiJS is stubbed. Every scenario
 * ends on the error-invariant (`errors()` empty), the cheap catch-all for the
 * "X is not a constructor / cannot read property" class of integration breakage
 * that mocked unit tests can never see.
 *
 * These are the journeys that broke this month (new-game reset, fly→land→trade,
 * local delivery, combat) — their regression lives here, against the real flow.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const PULSE_DAMAGE = 14; // wpn_pulse — the starter weapon GameEngine.starterLoadout fits.

/** A minimal ShipPhysics at a fixed position (CombatModule only reads shipX/shipY). */
function physicsAt(x = 0, y = 0): ShipPhysics {
  return { shipX: x, shipY: y } as unknown as ShipPhysics;
}

/** A lightweight hostile NPC sprite (CombatModule reads x/y/npc/container only). */
function makeHostile(
  id: string,
  x: number,
  y: number,
  opts: { hull?: number; damage?: number } = {},
): NpcShipSprite {
  const hull = opts.hull ?? 100;
  return {
    x,
    y,
    npc: {
      id,
      name: id,
      hullHP: hull,
      maxHull: hull,
      damage: opts.damage ?? 20,
    },
  } as unknown as NpcShipSprite;
}

/** Build a single-objective DELIVERY contract for system `targetSystemId`. */
function deliveryTemplate(
  id: string,
  targetSystemId: string,
  cargo: ResourceType = ResourceType.LUXURY,
  amount = 5,
  credits = 500,
): QuestTemplate {
  const reward: Reward = { credits, experience: 0, items: [] };
  return {
    id,
    title: "Доставка груза",
    description: `Доставить ${amount} ед. ${cargo}.`,
    type: QuestType.DELIVERY,
    objectives: [
      {
        id: `${id}_obj`,
        description: `Доставить ${amount} ед. ${cargo}`,
        type: "COLLECT_ITEM",
        targetAmount: amount,
        itemType: cargo,
      },
    ],
    reward,
    dialogueAnchors: [],
    deadline: 0,
    failurePenalty: null,
    targetSystemId,
  };
}

/** Systems carrying at least one planet (the only ones the land/trade flow needs). */
function systemsWithPlanets(harness: RealEngineHarness) {
  return harness.galaxy()!.systems.filter((s) => s.planets.length > 0);
}

/** Let fire-and-forget engine work (e.g. the GAME_OVER transition) settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("Core-journey behaviour scenarios (real engine)", () => {
  let harness: RealEngineHarness;

  beforeEach(async () => {
    localStorage.clear();
    harness = await RealEngineHarness.boot();
  });

  afterEach(() => {
    harness?.dispose();
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("Scenario: «Новая игра» yields a genuinely fresh game", () => {
    it("resets player, quests, ledger and flight position from an in-progress game", async () => {
      // Given an in-progress game with a completed + an active quest, credits
      // moved off the starter balance, and a persisted flight position.
      await harness.newGame();
      const player = harness.player()!;
      const starterCredits = harness.credits();

      const done = harness
        .quests()
        .acceptQuestFromTemplate(
          deliveryTemplate("jq_done", player.currentSystemId),
          "issuer",
        );
      expect(done).not.toBeNull();
      harness.quests().forceCompleteQuest(done!.id, player); // grants reward → moves credits
      const active = harness
        .quests()
        .acceptQuestFromTemplate(
          deliveryTemplate("jq_active", player.currentSystemId),
          "issuer",
        );
      expect(active).not.toBeNull();
      harness.engine.lastFlightShipPos = { x: 123, y: 456 };

      // Pre-state sanity: a real in-progress game (quests on the board, credits
      // off the starter balance, a stored ship position).
      expect(harness.player()).not.toBeNull();
      expect(harness.quests().getActiveQuests()).toHaveLength(1);
      expect(harness.quests().getCompletedQuestIds()).toContain("jq_done");
      expect(harness.credits()).toBeGreaterThan(starterCredits);

      const resetLedgerSpy = vi.spyOn(
        harness.engine.bankingService,
        "resetLedger",
      );

      // When the player picks «Новая игра» (the real restart path).
      await harness.engine.restartNewGame();

      // Then player/quests/flight-pos are wiped and the ledger was reset.
      expect(harness.player()).toBeNull();
      expect(harness.quests().getActiveQuests()).toEqual([]);
      expect(harness.quests().getCompletedQuestIds()).toEqual([]);
      expect(harness.engine.lastFlightShipPos).toBeNull();
      expect(resetLedgerSpy).toHaveBeenCalled();
      expect(harness.currentSceneType()).toBe(SceneType.RACE_SELECTION);

      // And starting again re-seeds a clean ledger — the prior game's credits do
      // not carry over (the projection is back to the fresh starter balance).
      await harness.newGame();
      expect(harness.credits()).toBe(starterCredits);
      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: fly → land → trade", () => {
    it("reaches the planet scene and the market is openable, with no errors", async () => {
      // Given a fresh game in flight.
      await harness.newGame();
      const sys = systemsWithPlanets(harness)[0];
      expect(sys).toBeDefined();
      const planet = sys.planets[0];
      harness.player()!.currentSystemId = sys.id;

      // When the player routes to the planet and lands.
      await harness.goTo(SceneType.PLANET, { planet });
      expect(harness.currentSceneType()).toBe(SceneType.PLANET);
      expect(harness.currentScene()).not.toBeNull();

      // Then the market is openable from the planet.
      await harness.goTo(SceneType.TRADE, { planet });
      expect(harness.currentSceneType()).toBe(SceneType.TRADE);
      expect(harness.currentScene()).not.toBeNull();

      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: local delivery to a neighbour planet", () => {
    it("completes + pays on the target system, but not on the issuer", async () => {
      // Given a delivery contract for a *different* system and the cargo in hold.
      await harness.newGame();
      const withPlanets = systemsWithPlanets(harness);
      expect(withPlanets.length).toBeGreaterThanOrEqual(2);
      const issuer = withPlanets[0];
      const target = withPlanets[1];
      const player = harness.player()!;
      player.inventory.resources.push({
        type: ResourceType.LUXURY,
        amount: 10,
      });

      const quest = harness
        .quests()
        .acceptQuestFromTemplate(
          deliveryTemplate(
            "jq_deliver",
            target.id,
            ResourceType.LUXURY,
            5,
            500,
          ),
          issuer.planets[0].id,
        );
      expect(quest).not.toBeNull();
      const creditsBefore = harness.credits();

      // When the player lands on the ISSUER planet (wrong system) — nothing pays.
      player.currentSystemId = issuer.id;
      await harness.goTo(SceneType.PLANET, { planet: issuer.planets[0] });
      expect(
        harness
          .quests()
          .getActiveQuests()
          .map((q) => q.id),
      ).toContain("jq_deliver");
      expect(harness.credits()).toBe(creditsBefore);

      // When the player then lands on the TARGET planet — it completes and pays.
      player.currentSystemId = target.id;
      await harness.goTo(SceneType.PLANET, { planet: target.planets[0] });

      // Then the contract is gone from the active board and the reward landed.
      expect(
        harness
          .quests()
          .getActiveQuests()
          .map((q) => q.id),
      ).not.toContain("jq_deliver");
      expect(harness.quests().getCompletedQuestIds()).toContain("jq_deliver");
      expect(harness.credits()).toBe(creditsBefore + 500);
      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: combat engages", () => {
    /** A real CombatModule wired to the booted engine's player loadout + ship. */
    function realCombat(
      ship: { hullHP: number; maxHull: number },
      hooks: {
        onNpcDestroyed?: (s: NpcShipSprite) => void;
        onPlayerDestroyed?: () => void;
      } = {},
    ): CombatModule {
      return new CombatModule({
        getShipPhysics: () => physicsAt(0, 0),
        getPlayerLoadout: () => harness.engine.playerLoadout,
        getPlayerShip: () => ship,
        getGameMode: () => harness.player()!.gameMode,
        isPaused: () => false, // drive the timers directly (no active pause)
        onPlayerUnderAttack: () => {}, // keep the fight un-paused so both sides fire
        onNpcDestroyed: hooks.onNpcDestroyed,
        onPlayerDestroyed: hooks.onPlayerDestroyed,
        showMessage: () => {},
      });
    }

    it("both sides fire and hull drops when a hostile NPC is in range", async () => {
      // Given a weaponed real player (starter wpn_pulse) and a hostile NPC in range.
      await harness.newGame();
      const ship = harness.player()!.ship;
      const maxHull = ship.maxHull;
      const module = realCombat(ship);
      const npc = makeHostile("hostile-a", 50, 0, { hull: 100, damage: 20 });
      module.addCombatant(npc); // auto-selects it as the player's target

      // When combat ticks one fire interval.
      module.update(FIRE);

      // Then both sides fired: the NPC took the player's weapon damage and the
      // player's hull dropped by the NPC's damage.
      expect(npc.npc.hullHP).toBe(100 - PULSE_DAMAGE);
      expect(ship.hullHP).toBe(maxHull - 20);
      module.destroy();
      expect(harness.errors()).toEqual([]);
    });

    it("an NPC kill routes to loot and never triggers a false game win", async () => {
      // Given a hostile NPC weak enough to die to one player shot.
      await harness.newGame();
      const ship = harness.player()!.ship;
      const looted: NpcShipSprite[] = [];
      const winSpy = vi.spyOn(harness.engine, "showGameOutcomeScreen");
      const module = realCombat(ship, {
        onNpcDestroyed: (s) => looted.push(s),
      });
      const npc = makeHostile("hostile-weak", 50, 0, { hull: 10, damage: 20 });
      module.addCombatant(npc);

      // When the player's shot kills it.
      module.update(FIRE);

      // Then it routes to the loot/death seam (onNpcDestroyed) and — crucially —
      // CombatModule itself never decides a win on a kill: it delegates death to
      // onNpcDestroyed and leaves the victory decision to the scene/NpcShipManager
      // (only the OVERMIND core wins). The end-to-end "normal kill ≠ victory" rule
      // lives in NpcShipManager.handleInFlightDeath, which this scenario does not
      // drive — see the harness's known coverage gap on the combat scene seam.
      expect(looted).toContain(npc);
      expect(winSpy).not.toHaveBeenCalled();
      module.destroy();
      expect(harness.errors()).toEqual([]);
    });

    it("a lethal hit routes the player to the game-over flow", async () => {
      // Given a hostile NPC whose shot is lethal.
      await harness.newGame();
      const ship = harness.player()!.ship;
      let deathReported = false;
      harness.engine.playerDeathCallback = () => {
        deathReported = true;
      };
      const module = realCombat(ship, {
        onPlayerDestroyed: () => harness.engine.triggerPlayerDeath(),
      });
      const npc = makeHostile("hostile-lethal", 50, 0, {
        hull: 100,
        damage: 99999,
      });
      module.addCombatant(npc);

      // When the lethal NPC shot lands.
      module.update(FIRE);
      await flush(); // let the fire-and-forget GAME_OVER transition settle

      // Then the real game-over flow fired (death callback + terminal scene).
      expect(deathReported).toBe(true);
      expect(harness.currentSceneType()).toBe(SceneType.GAME_OVER);
      module.destroy();
      expect(harness.errors()).toEqual([]);
    });
  });
});
