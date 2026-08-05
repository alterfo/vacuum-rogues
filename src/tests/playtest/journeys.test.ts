import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { SceneType, QuestType, ResourceType } from "@/types";
import type { Reward } from "@/types";
import type { QuestTemplate } from "@/core/ports/IQuestService";
import { questKey } from "@/systems/quests/QuestGenerator";
import { CombatModule } from "@/presentation/flight/CombatModule";
import type { NpcShipSprite } from "@/presentation/NpcShipSprite";
import type { ShipPhysics } from "@/systems/ShipPhysics";
import { GAME_BALANCE } from "@/config/balance";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const FIRE = GAME_BALANCE.combatFireIntervalMs;
const PULSE_DAMAGE = 14; // wpn_pulse — the starter weapon GameEngine.starterLoadout fits.

function physicsAt(x = 0, y = 0): ShipPhysics {
  return { shipX: x, shipY: y } as unknown as ShipPhysics;
}

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

function systemsWithPlanets(harness: RealEngineHarness) {
  return harness.galaxy()!.systems.filter((s) => s.planets.length > 0);
}

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

      expect(harness.player()).not.toBeNull();
      expect(harness.quests().getActiveQuests()).toHaveLength(1);
      expect(harness.quests().getCompletedQuestIds()).toContain("jq_done");
      expect(harness.credits()).toBeGreaterThan(starterCredits);

      const resetLedgerSpy = vi.spyOn(
        harness.engine.bankingService,
        "resetLedger",
      );

      await harness.engine.restartNewGame();

      expect(harness.player()).toBeNull();
      expect(harness.quests().getActiveQuests()).toEqual([]);
      expect(harness.quests().getCompletedQuestIds()).toEqual([]);
      expect(harness.engine.lastFlightShipPos).toBeNull();
      expect(resetLedgerSpy).toHaveBeenCalled();
      expect(harness.currentSceneType()).toBe(SceneType.RACE_SELECTION);

      await harness.newGame();
      expect(harness.credits()).toBe(starterCredits);
      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: a fresh game ships fully fitted (starter loadout)", () => {
    it("installs weapon + grapple + engine and leaves nothing loose in the hold", async () => {
      await harness.newGame();
      const player = harness.player()!;
      const loadout = harness.engine.playerLoadout!;

      const installed = loadout.installedGearIds();
      expect(installed).toContain("wpn_pulse"); // weapon
      expect(installed).toContain("grav_tractor_1"); // grapple/захват
      expect(installed).toContain("eq_engine_i"); // engine

      const stats = loadout.derivedStats();
      expect(stats.weaponDamage).toBeGreaterThan(0);
      expect(stats.gravTractorRange).toBeGreaterThan(0); // auto-pickup range

      expect(stats.massUsed).toBeLessThanOrEqual(stats.massCapacity);

      expect(player.inventory.modules).toEqual([]);
      expect(player.inventory.ownedGearIds ?? []).toEqual([]);

      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: fly → land → trade", () => {
    it("reaches the planet scene and the market is openable, with no errors", async () => {
      await harness.newGame();
      const sys = systemsWithPlanets(harness)[0];
      expect(sys).toBeDefined();
      const planet = sys.planets[0];
      harness.player()!.currentSystemId = sys.id;

      await harness.goTo(SceneType.PLANET, { planet });
      expect(harness.currentSceneType()).toBe(SceneType.PLANET);
      expect(harness.currentScene()).not.toBeNull();

      await harness.goTo(SceneType.TRADE, { planet });
      expect(harness.currentSceneType()).toBe(SceneType.TRADE);
      expect(harness.currentScene()).not.toBeNull();

      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: local delivery to a neighbour planet", () => {
    it("completes + pays on the target system, but not on the issuer", async () => {
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

      player.currentSystemId = issuer.id;
      await harness.goTo(SceneType.PLANET, { planet: issuer.planets[0] });
      expect(
        harness
          .quests()
          .getActiveQuests()
          .map((q) => q.id),
      ).toContain("jq_deliver");
      expect(harness.credits()).toBe(creditsBefore);

      player.currentSystemId = target.id;
      await harness.goTo(SceneType.PLANET, { planet: target.planets[0] });

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

  describe("Scenario: in-system «Местный подряд» courier targets a neighbour", () => {
    it("completes on the target planet but NOT on the issuer planet in the same system", async () => {
      await harness.newGame();
      const multi = systemsWithPlanets(harness).find(
        (s) => s.planets.length >= 2,
      );
      expect(multi).toBeDefined();
      const system = multi!;
      const issuerPlanet = system.planets[0];
      const neighbourPlanet = system.planets[1];
      const player = harness.player()!;
      player.inventory.resources.push({
        type: ResourceType.LUXURY,
        amount: 10,
      });
      player.currentSystemId = system.id;

      const quest = harness.quests().acceptQuestFromTemplate(
        {
          ...deliveryTemplate(
            "jq_courier",
            system.id,
            ResourceType.LUXURY,
            5,
            400,
          ),
          targetPlanetId: neighbourPlanet.id,
        },
        issuerPlanet.id,
      );
      expect(quest).not.toBeNull();
      expect(quest!.targetPlanetId).toBe(neighbourPlanet.id);
      const creditsBefore = harness.credits();

      await harness.goTo(SceneType.PLANET, { planet: issuerPlanet });
      expect(
        harness
          .quests()
          .getActiveQuests()
          .map((q) => q.id),
      ).toContain("jq_courier");
      expect(harness.credits()).toBe(creditsBefore);

      await harness.goTo(SceneType.PLANET, { planet: neighbourPlanet });
      expect(
        harness
          .quests()
          .getActiveQuests()
          .map((q) => q.id),
      ).not.toContain("jq_courier");
      expect(harness.quests().getCompletedQuestIds()).toContain("jq_courier");
      expect(harness.credits()).toBe(creditsBefore + 400);
      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: combat engages", () => {
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
      await harness.newGame();
      const ship = harness.player()!.ship;
      const maxHull = ship.maxHull;
      const module = realCombat(ship);
      const npc = makeHostile("hostile-a", 50, 0, { hull: 100, damage: 20 });
      module.addCombatant(npc); // auto-selects it as the player's target

      module.update(FIRE);

      expect(npc.npc.hullHP).toBe(100 - PULSE_DAMAGE);
      expect(ship.hullHP).toBe(maxHull - 20);
      module.destroy();
      expect(harness.errors()).toEqual([]);
    });

    it("an NPC kill routes to loot and never triggers a false game win", async () => {
      await harness.newGame();
      const ship = harness.player()!.ship;
      const looted: NpcShipSprite[] = [];
      const winSpy = vi.spyOn(harness.engine, "showGameOutcomeScreen");
      const module = realCombat(ship, {
        onNpcDestroyed: (s) => looted.push(s),
      });
      const npc = makeHostile("hostile-weak", 50, 0, { hull: 10, damage: 20 });
      module.addCombatant(npc);

      module.update(FIRE);

      expect(looted).toContain(npc);
      expect(winSpy).not.toHaveBeenCalled();
      module.destroy();
      expect(harness.errors()).toEqual([]);
    });

    it("a lethal hit routes the player to the game-over flow", async () => {
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

      module.update(FIRE);
      await flush(); // let the fire-and-forget GAME_OVER transition settle

      expect(deathReported).toBe(true);
      expect(harness.currentSceneType()).toBe(SceneType.GAME_OVER);
      module.destroy();
      expect(harness.errors()).toEqual([]);
    });
  });

  describe("Scenario: the job board does not re-offer a taken quest", () => {
    it("an accepted board quest disappears from the next board (real wiring)", async () => {
      await harness.newGame();
      const player = harness.player()!;
      const originSystem = harness
        .galaxy()!
        .systems.find((s) => s.id === player.currentSystemId)!;
      const planetId = originSystem.planets[0]?.id;
      expect(planetId).toBeDefined();

      const board1 = harness.engine.getQuestBoard(planetId!);
      expect(board1.length).toBeGreaterThan(0);
      const taken = board1[0];
      const acceptedKey = questKey(taken);
      const accepted = harness.engine.acceptBoardQuest(taken, planetId!);
      expect(accepted).not.toBeNull();

      const board2 = harness.engine.getQuestBoard(planetId!);

      expect(board2.map((q) => q.template.id)).not.toContain(taken.template.id);
      expect(board2.map((q) => questKey(q))).not.toContain(acceptedKey);
      expect(harness.errors()).toEqual([]);
    });
  });
});
