import { NpcState, QuestType, SceneType } from "@/types";
import { GAME_BALANCE, WRECK } from "@/config/balance";
import { WRECK_LOOT_SPREAD_FRACTION } from "@/presentation/flight/combatExecution";
import type { NpcShip } from "@/domain/NpcShip";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { observe, type Observation } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import {
  type AgentMemory,
  createMemory,
  questBaselineForObserve,
  updateMemory,
} from "./AgentMemory";
import {
  currentSystem,
  landedPlanet,
  acceptBoardQuests,
  executeMemoryAwareTrade,
  executeSellAll,
  executeRepair,
  pickWarpTarget,
  questRoutingPreference,
  reachableNeighbors,
  systemHopDistances,
} from "./engineQueries";
import { bestKnownMargin } from "./memoryFeatures";
import { deliveryCargoNeed } from "./observeHelpers";
import { warpWantsQuestBias } from "./MemoryHeuristicPolicy";
import {
  executeBuyBestGear,
  executeUpgradeHull,
  executeBuyBestModule,
  executeArmUp,
} from "./equipmentQueries";
import { executeTakeLoan, executeRepayLoan } from "./bankingQueries";
import { confirmPlanningIfOpen } from "./planningDriver";

export interface StepVitals {
  credits: number;
  hull: number;
  maxHull: number;
  fuel: number;
  cargoUsed: number;
  reputationMin: number;
  killPoints: number;
  questsActive: number;
  questsCompleted: number;
}

export interface AgentStep {
  readonly index: number;
  readonly scene: SceneType;
  readonly action: Action;
  readonly day?: number;
  readonly vitals?: StepVitals;
  readonly notableLogs?: string[];
}

export interface AgentRunResult {
  readonly steps: AgentStep[];
  readonly errors: RecordedError[];
  readonly endScene: SceneType;
  readonly finalDay?: number;
  readonly finalVitals?: StepVitals;
}

const ATTACK_TICK_MS = 50;
export const LOOT_LINGER_TICKS = Math.ceil(
  (WRECK.lifeMs * WRECK_LOOT_SPREAD_FRACTION) / ATTACK_TICK_MS,
);

export const SHIELD_CELL_CONSUMABLE_ID = "con_shield_cell";
const SHIELD_CELL_HULL_FRACTION = 0.3;
const DEMAND_SURRENDER_TARGET_HULL_FRACTION = 0.3;

export class PlayerAgent {
  private memory: AgentMemory = createMemory();
  private lastSystemId: string | null = null;

  constructor(
    private readonly harness: RealEngineHarness,
    private readonly policy: PlayerPolicy,
  ) {}

  get belief(): AgentMemory {
    return this.memory;
  }

  reset(): void {
    this.memory = createMemory();
    this.lastSystemId = null;
  }

  async run(budget: number): Promise<AgentRunResult> {
    const engine = this.harness.engine;
    const steps: AgentStep[] = [];
    for (let index = 0; index < budget; index++) {
      const obs = observe(engine, questBaselineForObserve(this.memory, engine));
      this.memory = updateMemory(this.memory, obs);
      const action = this.policy.decide(obs, this.memory);
      const day = engine.galaxy?.gameDays ?? 0;
      const vitals = this.snapVitals(obs);
      const logsBefore = this.harness.errors().length;
      await this.apply(action, obs);
      const notableLogs = this.harness
        .errors()
        .slice(logsBefore)
        .map((e) => `[${e.source}] ${e.message}`);
      steps.push({
        index,
        scene: obs.scene,
        action,
        day,
        ...(vitals ? { vitals } : {}),
        ...(notableLogs.length ? { notableLogs } : {}),
      });
    }
    const finalVitals = this.snapVitals(observe(engine));
    return {
      steps,
      errors: this.harness.errors(),
      endScene: engine.currentSceneType,
      finalDay: engine.galaxy?.gameDays ?? 0,
      ...(finalVitals ? { finalVitals } : {}),
    };
  }

  private snapVitals(obs: Observation): StepVitals | null {
    const engine = this.harness.engine;
    const player = engine.player;
    if (!obs.player || !player) return null;
    const repValues = Object.values(
      player.reputation as Record<string, number>,
    );
    return {
      credits: obs.player.credits,
      hull: obs.player.hull,
      maxHull: obs.player.maxHull,
      fuel: obs.player.fuel,
      cargoUsed: obs.player.cargoUsed,
      reputationMin: repValues.length ? Math.min(...repValues) : 0,
      killPoints: player.killPoints,
      questsActive: engine.questManager.getActiveQuests().length,
      questsCompleted: engine.questManager.getCompletedQuestIds().length,
    };
  }

  private async apply(action: Action, obs: Observation): Promise<void> {
    const engine = this.harness.engine;

    if (
      obs.warpInTransit &&
      action.kind !== "wait" &&
      action.kind !== "attack" &&
      action.kind !== "flee"
    ) {
      await this.completeWarp();
      return;
    }

    switch (action.kind) {
      case "wait":
        if (obs.warpInTransit) await this.completeWarp();
        else this.waitOneDay();
        return;

      case "move": {
        if (obs.scene === SceneType.SPACE_FLIGHT) this.flyForward();
        else if (obs.scene === SceneType.STATION) {
          const fromStationId = (
            engine.currentScene as { station?: { id?: string } } | null
          )?.station?.id;
          await this.harness.goTo(
            SceneType.SPACE_FLIGHT,
            fromStationId ? { fromStationId } : {},
          );
        } else await this.harness.goTo(SceneType.SPACE_FLIGHT);
        return;
      }

      case "land": {
        const sys = currentSystem(engine);
        const planet = sys?.planets.find((p) => p.id === action.targetId);
        if (planet) {
          await this.harness.goTo(SceneType.PLANET, { planet });
          const ship = engine.player?.ship;
          if (ship) ship.energy = ship.maxEnergy;
        } else {
          this.harness.tick();
        }
        return;
      }

      case "dock": {
        const sys = currentSystem(engine);
        const station =
          sys?.stations.find((s) => s.id === action.targetId) ??
          sys?.stations[0];
        if (station) {
          await this.harness.goTo(SceneType.STATION, { station });
          const ship = engine.player?.ship;
          if (ship) ship.energy = ship.maxEnergy;
        } else {
          this.harness.tick();
        }
        return;
      }

      case "trade": {
        const planet =
          landedPlanet(engine) ?? currentSystem(engine)?.planets[0];
        if (!planet) {
          this.harness.tick();
          return;
        }
        if (obs.scene === SceneType.TRADE) {
          const questNeed = deliveryCargoNeed(
            obs.quests,
            obs.currentPlanet?.market,
          );
          const questCommittedGoods = new Set(
            obs.quests
              .filter((q) => q.type === QuestType.DELIVERY && q.collectItem)
              .map((q) => q.collectItem!.type),
          );
          if (questNeed) {
            executeMemoryAwareTrade(
              engine,
              planet,
              questNeed.good,
              questNeed.qty,
              questCommittedGoods,
            );
          } else {
            const margin = bestKnownMargin(this.memory);
            const preferredGood =
              margin.buyPlanet === planet.id ? margin.good : null;
            executeMemoryAwareTrade(
              engine,
              planet,
              preferredGood,
              undefined,
              questCommittedGoods,
            );
          }
          await this.harness.goTo(SceneType.PLANET, { planet });
          return;
        }
        if (obs.scene === SceneType.PLANET) {
          await this.harness.goTo(SceneType.TRADE, { planet });
          return;
        }
        await this.harness.goTo(SceneType.PLANET, { planet });
        return;
      }

      case "take-quest": {
        acceptBoardQuests(engine, this.memory.completedQuestsBaseline);
        this.harness.tick();
        return;
      }

      case "warp": {
        if (obs.scene !== SceneType.STAR_MAP) {
          await this.harness.goTo(SceneType.STAR_MAP);
          return;
        }
        const sys = currentSystem(engine);
        const connections = reachableNeighbors(
          engine.galaxy?.systems ?? [],
          sys?.id ?? null,
        );
        const hostileHeld = new Set([
          ...(engine.galaxy?.overmindSystems ?? []),
          ...(engine.galaxy?.pirateSystems ?? []),
        ]);
        const rawQuestTarget = warpWantsQuestBias(action.reason)
          ? questRoutingPreference(obs.quests, sys?.id ?? null)
          : null;
        const questTarget =
          rawQuestTarget != null && hostileHeld.has(rawQuestTarget)
            ? null
            : rawQuestTarget;
        const directTarget =
          action.targetId &&
          connections.some((c) => c.toSystemId === action.targetId)
            ? action.targetId
            : undefined;
        const destination =
          directTarget == null &&
          action.targetId != null &&
          !hostileHeld.has(action.targetId) &&
          (engine.galaxy?.systems ?? []).some((s) => s.id === action.targetId)
            ? action.targetId
            : null;
        const prefer = destination ?? questTarget;
        const hopsToPrefer =
          prefer != null
            ? systemHopDistances(engine.galaxy?.systems ?? [], prefer)
            : undefined;
        const target =
          directTarget ??
          pickWarpTarget(
            connections,
            this.lastSystemId,
            this.memory.visitedSystemIds,
            hostileHeld,
            prefer,
            hopsToPrefer,
          );
        this.lastSystemId = sys?.id ?? null;
        const scene = this.harness.currentScene() as {
          performWarpJumpTo?: (id: string) => Promise<void>;
        } | null;
        if (target && typeof scene?.performWarpJumpTo === "function") {
          const startSys = engine.player?.currentSystemId;
          await scene.performWarpJumpTo(target);
          if (engine.currentSceneType === SceneType.SPACE_FLIGHT) {
            await this.completeWarp(startSys);
          } else {
            await this.harness.goTo(SceneType.SPACE_FLIGHT);
          }
        } else {
          await this.harness.goTo(SceneType.SPACE_FLIGHT);
        }
        return;
      }

      case "buy-gear":
        executeBuyBestGear(engine);
        this.harness.tick();
        return;

      case "upgrade-hull":
        executeUpgradeHull(engine);
        this.harness.tick();
        return;

      case "buy-module":
        executeBuyBestModule(engine);
        this.harness.tick();
        return;

      case "arm-up":
        executeArmUp(engine);
        this.harness.tick();
        return;

      case "take-loan":
        executeTakeLoan(engine);
        this.harness.tick();
        return;

      case "repay-loan":
        executeRepayLoan(engine);
        this.harness.tick();
        return;

      case "sell-cargo": {
        const planet = landedPlanet(engine);
        if (planet) executeSellAll(engine, planet);
        if (planet && obs.scene === SceneType.TRADE) {
          await this.harness.goTo(SceneType.PLANET, { planet });
        } else {
          this.harness.tick();
        }
        return;
      }

      case "attack": {
        if (obs.warpInTransit) {
          await this.completeWarp();
          return;
        }
        const targetId = action.targetId ?? obs.hostiles[0]?.id;
        const target = targetId
          ? engine.galaxy?.npcShips.find((n) => n.id === targetId && n.hostile)
          : undefined;
        if (!target) {
          this.waitOneDay();
          return;
        }
        this.driveAttack(target);
        return;
      }

      case "flee": {
        const fleeSys = currentSystem(engine);
        const fleeConns = fleeSys?.connections ?? [];
        if (fleeConns.length === 0) {
          this.waitOneDay();
          return;
        }
        await this.harness.goTo(SceneType.STAR_MAP);
        return;
      }

      case "repair":
        executeRepair(engine);
        this.harness.tick();
        return;

      case "liberate":
        engine.liberateCurrentSystem();
        this.harness.tick();
        return;

      default:
        this.harness.tick();
        return;
    }
  }

  private async completeWarp(startSys?: string): Promise<void> {
    const engine = this.harness.engine;
    const sys0 = startSys ?? engine.player?.currentSystemId;
    const flightScene = this.harness.currentScene() as unknown as {
      onPlayPause?(): void;
      endTurn?(): void;
      isTurnRunning?: boolean;
      combatPause?: { paused?: boolean; resume?(): void } | null;
      combatModule?: { isActive?: boolean; beginCombatRound?(): void } | null;
      pendingWarp?: unknown;
    } | null;

    flightScene?.combatModule?.beginCombatRound?.();

    if (
      flightScene?.combatPause?.paused &&
      typeof flightScene.combatPause.resume === "function"
    ) {
      flightScene.combatPause.resume();
    }
    const confirmedAtEntry = confirmPlanningIfOpen(flightScene);
    if (!confirmedAtEntry) {
      if (
        flightScene?.isTurnRunning &&
        typeof flightScene.endTurn === "function"
      ) {
        flightScene.endTurn();
      }
      if (
        !flightScene?.isTurnRunning &&
        typeof flightScene?.onPlayPause === "function"
      ) {
        flightScene.onPlayPause();
      }
    }

    for (let i = 0; i < 2000; i++) {
      if (
        flightScene?.combatPause?.paused &&
        typeof flightScene.combatPause.resume === "function"
      ) {
        flightScene.combatPause.resume();
      }
      confirmPlanningIfOpen(flightScene);
      this.harness.tick(50);
      await Promise.resolve(); // yield so async performWarp() can settle
      if (engine.player?.currentSystemId !== sys0) break;
      if (
        !flightScene?.isTurnRunning &&
        typeof flightScene?.onPlayPause === "function"
      ) {
        if (!confirmPlanningIfOpen(flightScene)) flightScene.onPlayPause();
      }
    }

    if (
      engine.player?.currentSystemId === sys0 &&
      flightScene?.pendingWarp != null
    ) {
      flightScene.pendingWarp = null;
      if (
        flightScene.isTurnRunning &&
        typeof flightScene.endTurn === "function"
      ) {
        flightScene.endTurn();
      }
    }
  }

  private waitOneDay(): void {
    const engine = this.harness.engine;
    const scene = this.harness.currentScene() as unknown as {
      onPlayPause?(): void;
      endTurn?(): void;
      isTurnRunning?: boolean;
      combatPause?: { paused?: boolean; resume?(): void } | null;
      combatModule?: {
        isActive?: boolean;
        roundComplete?: boolean;
        beginCombatRound?(): void;
      } | null;
    } | null;
    if (
      engine.currentSceneType !== SceneType.SPACE_FLIGHT ||
      typeof scene?.onPlayPause !== "function"
    ) {
      this.harness.tick();
      return;
    }
    const day0 = engine.galaxy?.gameDays ?? 0;
    confirmPlanningIfOpen(scene);
    if (!scene.isTurnRunning) scene.onPlayPause(); // start the course-less wait
    scene.combatModule?.beginCombatRound?.();
    for (let i = 0; i < 4; i++) {
      if (
        scene.combatPause?.paused &&
        typeof scene.combatPause.resume === "function"
      ) {
        scene.combatPause.resume();
      }
      confirmPlanningIfOpen(scene);
      this.harness.tick(1000);
      if (scene.combatModule?.roundComplete === true) break;
      const dayAdvanced = (engine.galaxy?.gameDays ?? 0) > day0;
      const inCombat = scene.combatModule?.isActive === true;
      if (dayAdvanced && !inCombat) break;
    }
    if (scene.isTurnRunning && typeof scene.endTurn === "function") {
      scene.endTurn();
    }
  }

  private driveAttack(target: NpcShip): void {
    const engine = this.harness.engine;
    const scene = this.harness.currentScene() as unknown as {
      onPlayPause?(): void;
      endTurn?(): void;
      isTurnRunning?: boolean;
      combatPause?: { paused?: boolean; resume?(): void } | null;
      combatModule?: {
        isActive?: boolean;
        roundComplete?: boolean;
        beginCombatRound?(): void;
      } | null;
      combatPlanning?: { isPlanning?: boolean } | null;
      npcManager?: { onAttackNpc?(npc: NpcShip): void };
    } | null;
    if (
      engine.currentSceneType !== SceneType.SPACE_FLIGHT ||
      typeof scene?.onPlayPause !== "function" ||
      typeof scene?.npcManager?.onAttackNpc !== "function"
    ) {
      this.waitOneDay();
      return;
    }

    const alreadyFighting = scene.combatModule?.isActive === true;
    if (!alreadyFighting) scene.npcManager.onAttackNpc(target);
    const playerShip = engine.player?.ship;
    let surrenderAttempted = false;
    let consumableUsed = false;
    const buildCombatOptions = () => {
      const targetHullFraction =
        target.maxHull > 0 ? target.hullHP / target.maxHull : 1;
      const playerHullFraction =
        playerShip && playerShip.maxHull > 0
          ? playerShip.hullHP / playerShip.maxHull
          : 1;
      const wantsSurrender =
        !surrenderAttempted &&
        targetHullFraction < DEMAND_SURRENDER_TARGET_HULL_FRACTION;
      if (wantsSurrender) surrenderAttempted = true;
      const wantsConsumable =
        !consumableUsed &&
        playerHullFraction < SHIELD_CELL_HULL_FRACTION &&
        (engine.player?.inventory.hasConsumable(SHIELD_CELL_CONSUMABLE_ID) ??
          false);
      if (wantsConsumable) consumableUsed = true;
      return {
        preferredTargetId: target.id,
        closeOnTarget: true,
        weaponClassAwareTargeting: true,
        afterburner: !alreadyFighting,
        consumableId: wantsConsumable ? SHIELD_CELL_CONSUMABLE_ID : null,
        commsAction: wantsSurrender ? "demand-surrender" : null,
      };
    };
    confirmPlanningIfOpen(scene, buildCombatOptions());
    if (!scene.isTurnRunning) scene.onPlayPause();
    scene.combatModule?.beginCombatRound?.();
    const stepHull0 = engine.player?.ship?.hullHP ?? 0;
    const stepBudget = Math.max(
      1,
      (engine.player?.ship?.maxHull ?? 0) *
        GAME_BALANCE.combatRoundHullFraction,
    );
    let lootLingerTicksLeft: number | null = null;
    for (let i = 0; i < 2000; i++) {
      if (
        scene.combatPause?.paused &&
        typeof scene.combatPause.resume === "function"
      ) {
        scene.combatPause.resume();
      }
      confirmPlanningIfOpen(scene, buildCombatOptions());
      this.harness.tick(50);
      if (stepHull0 - (engine.player?.ship?.hullHP ?? stepHull0) >= stepBudget)
        break;
      if (engine.currentSceneType !== SceneType.SPACE_FLIGHT) return;
      const resolved = alreadyFighting
        ? // Driving a pre-engaged exchange: done when the fight resolves.
          scene.combatModule?.isActive !== true
        : // Chasing our own pick: done when it dies (loot lingers below) or
          target.state === NpcState.DEAD || target.hullHP <= 0;
      if (
        !alreadyFighting &&
        !resolved &&
        target.currentSystemId !== engine.player?.currentSystemId
      ) {
        break;
      }
      if (resolved) {
        if (lootLingerTicksLeft === null) {
          lootLingerTicksLeft = LOOT_LINGER_TICKS;
        }
        if (lootLingerTicksLeft <= 0) break;
        lootLingerTicksLeft--;
        continue;
      }
      if (scene.combatModule?.roundComplete === true) break;
    }
    if (scene.isTurnRunning && typeof scene.endTurn === "function") {
      scene.endTurn();
    }
  }

  private flyForward(): void {
    const engine = this.harness.engine;
    const scene = this.harness.currentScene() as unknown as {
      executeRouteTo?(x: number, y: number): void;
      shipPhysics?: { shipX: number; shipY: number; isMoving: boolean } | null;
      starRenderer?: { centerX: number; centerY: number };
    } | null;
    const physics = scene?.shipPhysics;
    if (
      typeof scene?.executeRouteTo !== "function" ||
      !physics ||
      !scene.starRenderer
    ) {
      this.waitOneDay();
      return;
    }
    const cx = scene.starRenderer.centerX;
    const cy = scene.starRenderer.centerY;
    const dx = cx - physics.shipX;
    const dy = cy - physics.shipY;
    const dist = Math.hypot(dx, dy) || 1;
    const SAFE = 240; // stay clear of the star's contact-damage radius
    let tx: number;
    let ty: number;
    if (dist > SAFE + 80) {
      const f = (dist - SAFE) / dist; // stop a ring short of the star
      tx = physics.shipX + dx * f;
      ty = physics.shipY + dy * f;
    } else {
      tx = physics.shipX - (dx / dist) * 700;
      ty = physics.shipY - (dy / dist) * 700;
    }
    const day0 = engine.galaxy?.gameDays ?? 0;
    scene.executeRouteTo(tx, ty);
    for (let i = 0; i < 800; i++) {
      confirmPlanningIfOpen(scene);
      this.harness.tick();
      if ((engine.galaxy?.gameDays ?? 0) > day0) break;
      if (!physics.isMoving) break;
    }
  }
}
