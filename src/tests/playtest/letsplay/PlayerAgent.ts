/**
 * Letsplay engine — the agent loop + action applier (dev-only).
 *
 * {@link PlayerAgent} closes the loop: each step it `observe`s the live engine,
 * asks its {@link PlayerPolicy} to `decide`, **applies** that action onto the
 * real {@link GameEngine} through the {@link RealEngineHarness}, then advances a
 * frame — `observe → decide → apply → tick` — for a fixed step budget, recording
 * a transcript and surfacing the harness error sink at the end.
 *
 * The applier maps each abstract {@link Action} to a *real* engine effect via the
 * harness:
 *  - `land`/`dock`/`trade`/`move` → genuine `transitionTo` scene wiring;
 *  - `warp` → navigate to the star map, then the real `performWarpJumpTo` jump;
 *  - `take-quest` → accept the landed planet's offered, registered contracts;
 *  - `wait`/`attack`/`flee`/`repair` → advance a frame (combat/repair are driven
 *    by their own modules; here they degrade to a safe tick).
 *
 * Every mapped operation is chosen to never call `logger.error`, so a clean
 * session ends with `errors()` empty — the agent's value as a bug-finder is that
 * a *real* engine fault (an integration break) is exactly what shows up there.
 * Dev-only: lives under `src/tests/`, imported by no production module.
 */
import { SceneType } from "@/types";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { observe, type Observation } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { type AgentMemory, createMemory, updateMemory } from "./AgentMemory";
import {
  currentSystem,
  landedPlanet,
  acceptBoardQuests,
  executeMemoryAwareTrade,
  executeSellAll,
  executeRepair,
  pickWarpTarget,
} from "./engineQueries";
import { bestKnownMargin } from "./memoryFeatures";
import {
  executeBuyBestGear,
  executeUpgradeHull,
  executeBuyBestModule,
} from "./equipmentQueries";
import { executeTakeLoan, executeRepayLoan } from "./bankingQueries";

/**
 * A compact, egocentric vitals snapshot taken at one step — the player's own
 * scoreboard the LLM judge reasons over. Built solely from what the player can
 * perceive of *itself* (vitals + its own reputation sheet, kill points, and quest
 * journal), never from omniscient world state. All scalars so it serialises flat.
 */
export interface StepVitals {
  /** Spendable credits (the current-account GL projection). */
  credits: number;
  /** Current hull HP. */
  hull: number;
  /** Max hull HP (a rise flags a ship upgrade). */
  maxHull: number;
  /** Reactor energy / warp fuel. */
  fuel: number;
  /** Cargo units currently held. */
  cargoUsed: number;
  /**
   * Lowest faction standing the player holds (0 when no faction interacted) —
   * the signal-rich number for the "rep fell to −50 with no way back" oddity.
   */
  reputationMin: number;
  /** Cumulative combat kill points (resets on rank promotion). */
  killPoints: number;
  /** Number of active quests the player is carrying. */
  questsActive: number;
  /** Number of quests the player has completed so far. */
  questsCompleted: number;
}

/** One recorded decision in a session transcript. */
export interface AgentStep {
  /** Zero-based step index. */
  readonly index: number;
  /** The scene the decision was made in. */
  readonly scene: SceneType;
  /** The action the policy chose. */
  readonly action: Action;
  /** Galaxy business day when the decision was made (egocentric, pre-apply). */
  readonly day?: number;
  /** Player vitals snapshot BEFORE the action was applied (egocentric). */
  readonly vitals?: StepVitals;
  /**
   * Harness error-sink messages that newly surfaced *while applying this step* —
   * the notable-log evidence the judge keys off. Omitted/absent when none fired
   * (a clean step), so a clean session carries no log noise.
   */
  readonly notableLogs?: string[];
}

/** The outcome of an agent run — the transcript plus any failures surfaced. */
export interface AgentRunResult {
  /** Every observe→decide step taken, in order. */
  readonly steps: AgentStep[];
  /** The harness error sink (logged errors + global rejections) at run end. */
  readonly errors: RecordedError[];
  /** The scene the agent ended in. */
  readonly endScene: SceneType;
  /** Galaxy business day on the resting state after the last applied action. */
  readonly finalDay?: number;
  /**
   * Vitals snapshot of the resting state AFTER the last applied action — the
   * "after" reference the transcript builder diffs the final step against and the
   * closing point of every curve. Absent only when there was no player.
   */
  readonly finalVitals?: StepVitals;
}

/**
 * Drives the real engine as the player. Construct with a booted harness and a
 * policy, then `run(budget)`.
 *
 * The agent is a POMDP solver: it carries a **per-run** {@link AgentMemory} belief
 * notebook (a human's memory of what it has *seen*), folds each egocentric
 * observation into it **before** deciding, and hands `{obs, memory}` to its policy
 * — so a memory-using policy can act on remembered prices/threats/offers while the
 * memoryless heuristic simply ignores the notebook. The belief is created fresh
 * per agent (so a new session = a new game = a clean slate) and is inspectable via
 * {@link belief}; {@link reset} starts it over for an explicit re-run.
 */
export class PlayerAgent {
  /** Per-run belief state — folded from observations, never from omniscient state. */
  private memory: AgentMemory = createMemory();
  /** The system id the agent was in on the previous step — used to prefer unvisited warp targets. */
  private lastSystemId: string | null = null;

  constructor(
    private readonly harness: RealEngineHarness,
    private readonly policy: PlayerPolicy,
  ) {}

  /** The agent's current belief notebook (inspectable for transcripts / tests). */
  get belief(): AgentMemory {
    return this.memory;
  }

  /** Start a fresh per-run notebook — a human starting the game over. */
  reset(): void {
    this.memory = createMemory();
    this.lastSystemId = null;
  }

  /**
   * Play `budget` steps: observe → **remember** → decide → apply → tick. Each step
   * folds the egocentric observation into the per-run belief *before* the policy
   * decides, then passes `{obs, memory}` to it, so decisions are memory-informed.
   * Returns the transcript (each step's action carries the belief-driven `reason`)
   * plus the harness error sink. Never throws — a thrown applier error is caught by
   * the harness `tick` sink or recorded here as an `unhandled` failure, so the
   * caller asserts on `result.errors` rather than a try/catch. The belief persists
   * across calls (so the `run(1)`-per-step session driver keeps accumulating); call
   * {@link reset} to start a new run.
   */
  async run(budget: number): Promise<AgentRunResult> {
    const engine = this.harness.engine;
    const steps: AgentStep[] = [];
    for (let index = 0; index < budget; index++) {
      const obs = observe(engine);
      this.memory = updateMemory(this.memory, obs);
      const action = this.policy.decide(obs, this.memory);
      // Egocentric per-step record: the day + vitals the player perceives *now*,
      // plus any harness-sink error that fires while this action is applied.
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
    // A resting snapshot after the last applied action — the "after" reference the
    // transcript diffs the final step against and the closing point of the curves.
    const finalVitals = this.snapVitals(observe(engine));
    return {
      steps,
      errors: this.harness.errors(),
      endScene: engine.currentSceneType,
      finalDay: engine.galaxy?.gameDays ?? 0,
      ...(finalVitals ? { finalVitals } : {}),
    };
  }

  /**
   * Project the player's own scoreboard into a {@link StepVitals}. Egocentric: it
   * reads the already-observed vitals plus the player's *own* reputation sheet,
   * kill points and quest journal — never omniscient world state. Returns `null`
   * when there is no player (a pre-game menu), so the step simply carries no vitals.
   */
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

  /** Map one abstract action onto a real engine effect through the harness. */
  private async apply(action: Action, obs: Observation): Promise<void> {
    const engine = this.harness.engine;

    // Safety net: while a hyperjump is already in transit (ship flying to the
    // system edge), only a genuine combat reaction may override the wait —
    // land/dock/move/trade/etc. would each redirect the route or tear down the
    // scene via `goTo` (destroying SpaceFlightScene's private `pendingWarp`,
    // silently dropping the pending jump). Drive the warp to completion instead.
    // Mirrors LiveApplier's identical dispatch-layer gate so every policy (not
    // just the ones that happen to self-censor) is covered here too.
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
        // A real wait turn so a galaxy DAY actually passes (markets / NPC sim /
        // quests / Overmind all advance) — the agent's biggest gap was never
        // advancing time. Degrades to a plain frame outside flight.
        // When warpInTransit: the ship is already flying to the edge — drive it
        // to completion instead of starting a course-less day-wait that stalls it.
        if (obs.warpInTransit) await this.completeWarp();
        else this.waitOneDay();
        return;

      case "move": {
        // In flight "move" flies a REAL route across the system (so the ship
        // traverses space and the calendar advances, pixelsPerDay px = 1 day); on
        // a sub-screen it backs out toward flight (the universal "leave this panel").
        if (obs.scene === SceneType.SPACE_FLIGHT) this.flyForward();
        else await this.harness.goTo(SceneType.SPACE_FLIGHT);
        return;
      }

      case "land": {
        const sys = currentSystem(engine);
        // Only land on the exact targeted planet — never fall back to planets[0]
        // which may be uninhabited (no market, creates a spin-land-takeoff loop).
        const planet = sys?.planets.find((p) => p.id === action.targetId);
        if (planet) await this.harness.goTo(SceneType.PLANET, { planet });
        else this.harness.tick();
        return;
      }

      case "dock": {
        const sys = currentSystem(engine);
        const station =
          sys?.stations.find((s) => s.id === action.targetId) ??
          sys?.stations[0];
        if (station) await this.harness.goTo(SceneType.STATION, { station });
        else this.harness.tick();
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
          // Execute the actual market trade, then return to the planet lobby.
          // Pass the best-known cross-planet margin good from the agent's belief
          // so the trade executor buys the good with a known sell destination
          // rather than the locally-cheapest good regardless of resale value.
          executeMemoryAwareTrade(
            engine,
            planet,
            bestKnownMargin(this.memory).good,
          );
          await this.harness.goTo(SceneType.PLANET, { planet });
          return;
        }
        if (obs.scene === SceneType.PLANET) {
          await this.harness.goTo(SceneType.TRADE, { planet });
          return;
        }
        // From flight or elsewhere, navigate to the planet first.
        await this.harness.goTo(SceneType.PLANET, { planet });
        return;
      }

      case "take-quest": {
        acceptBoardQuests(engine);
        this.harness.tick();
        return;
      }

      case "warp": {
        // Two-step real warp: open the galaxy map, then jump to a neighbour.
        // (warpInTransit is handled by the blanket guard above — it's never
        // true here, since warpInTransit only fires in SPACE_FLIGHT.)
        if (obs.scene !== SceneType.STAR_MAP) {
          await this.harness.goTo(SceneType.STAR_MAP);
          return;
        }
        const sys = currentSystem(engine);
        const connections = sys?.connections ?? [];
        const target = pickWarpTarget(
          connections,
          this.lastSystemId,
          this.memory.visitedSystemIds,
        );
        this.lastSystemId = sys?.id ?? null;
        const scene = this.harness.currentScene() as {
          performWarpJumpTo?: (id: string) => Promise<void>;
        } | null;
        if (target && typeof scene?.performWarpJumpTo === "function") {
          const startSys = engine.player?.currentSystemId;
          await scene.performWarpJumpTo(target);
          if (engine.currentSceneType === SceneType.SPACE_FLIGHT) {
            // performWarpJumpTo transitions to SPACE_FLIGHT with a plannedRoute to
            // the system edge, but the ship does NOT start moving until the player
            // presses "Ход". completeWarp() kicks off the route and ticks until the
            // system changes (the warp fires on reaching the boundary).
            await this.completeWarp(startSys);
          } else {
            // Warp rejected (e.g. insufficient fuel) — go back to flight so the
            // agent can make a different decision (land to refuel, wait, etc.).
            await this.harness.goTo(SceneType.SPACE_FLIGHT);
          }
        } else {
          // No reachable connection — leave the star map.
          await this.harness.goTo(SceneType.SPACE_FLIGHT);
        }
        return;
      }

      // Economic actions execute their real domain effect directly (bypassing
      // the shop/bank UI, exactly as `trade` bypasses TradeScene's buttons) and
      // stay put — `legalActionsForScene` only ever offers them from a scene
      // already at the right place (STATION/EQUIPMENT_SHOP/BANK), so no extra
      // navigation is needed. Each executor is a safe no-op when nothing is
      // affordable/owed, so a "wrong" scene can never throw.
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

      case "take-loan":
        executeTakeLoan(engine);
        this.harness.tick();
        return;

      case "repay-loan":
        executeRepayLoan(engine);
        this.harness.tick();
        return;

      case "sell-cargo": {
        // `legalActionsForScene` only offers this from PLANET/TRADE, both of
        // which imply the player is landed — so this is a true no-op guard,
        // not a "pick any planet" fallback (selling at an unvisited planet's
        // market would silently misprice the trade).
        const planet = landedPlanet(engine);
        if (planet) executeSellAll(engine, planet);
        if (planet && obs.scene === SceneType.TRADE) {
          await this.harness.goTo(SceneType.PLANET, { planet });
        } else {
          this.harness.tick();
        }
        return;
      }

      // Combat: advance a full day with the turn running so NpcShipManager's
      // `updateCombat` fires, hostile NPCs close on the stationary ship, and
      // `startInFlightCombat` auto-initiates once they're in weapon range.
      // A single day (4 × 1000 ms) is enough for the starter weapon to defeat
      // a typical NPC (~26 shots × 25 dmg). waitOneDay() un-pauses on each tick
      // so weapons actually fire and the fight resolves rather than freezing.
      // While warpInTransit, waitOneDay()'s trailing endTurn() would halt the
      // ship short of the edge exactly like the actions the blanket guard
      // above already redirects (the route survives, but the turn — and so
      // the ship's motion — stops, with no way back in for a memoryless
      // policy that keeps picking "attack" while the hostile stays around).
      // Drive the warp forward instead: the turn is already running, so
      // real-time combat keeps auto-resolving via completeWarp()'s own
      // combat-pause handling.
      case "attack":
        if (obs.warpInTransit) await this.completeWarp();
        else this.waitOneDay();
        return;

      // Flee: escape by navigating to the star map and warping to another system.
      // If no connections exist (trapped with no exit), fight it out via waitOneDay.
      // The two-step sequence (flee → STAR_MAP; next step `warp` completes the jump)
      // mirrors the warp action's own two-step flow, so the policy naturally picks
      // `warp` on the next observe from STAR_MAP to finish the escape.
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

      default:
        this.harness.tick();
        return;
    }
  }

  /**
   * Drive a **pending hyperjump** to completion in the headless engine.
   *
   * After `performWarpJumpTo` the new `SpaceFlightScene` initialises with a
   * `plannedRoute` to the system edge, but the ship does NOT start moving —
   * the player must press «Ход» (US-070 #11). This calls `onPlayPause()` to
   * kick off that route, then ticks 50 ms at a time until the system changes
   * (the warp fires) or the budget is exhausted.
   *
   * Physics limits: `ShipPhysics.update` caps `dt` at 100 ms; max speed is
   * 0.1 px/ms, so each `tick(50)` moves the ship 5 px. The ship spawns at
   * `innerRadius` (600 px) from the star centre opposite the exit vector, and
   * the jump fires at `boundaryRadius` (2800 px) from centre — a max journey
   * of ~3400 px ≈ 680 ticks. The 2000-tick ceiling is a generous safety net.
   *
   * **Stale vs. active combat pause:** `onCombatEnded` calls `combatPause.reset()`
   * (which does NOT clear `_paused`) so after a resolved fight the pause flag is
   * stuck true. We clear it ONLY when `combatModule.isActive=false` (the fight
   * is over) — this is the *stale* case. If `isActive=true` (live fight), we
   * leave the pause alone: while paused, `npcManager.updateCombat` is also frozen
   * so NPCs can't fire — the ship stops safely, the loop times out, and the agent
   * retries on the next step without taking combat damage.
   */
  private async completeWarp(startSys?: string): Promise<void> {
    const engine = this.harness.engine;
    const sys0 = startSys ?? engine.player?.currentSystemId;
    const flightScene = this.harness.currentScene() as unknown as {
      onPlayPause?(): void;
      endTurn?(): void;
      isTurnRunning?: boolean;
      combatPause?: { paused?: boolean; resume?(): void } | null;
      combatModule?: { isActive?: boolean } | null;
    } | null;

    // Clear ONLY a stale pause (combat ended but pause flag wasn't cleared).
    // An active-combat pause (isActive=true) is left alone — ship stays frozen,
    // NPCs can't fire, player is safe while blocked by combat.
    const isActiveCombat = flightScene?.combatModule?.isActive === true;
    if (
      flightScene?.combatPause?.paused &&
      !isActiveCombat &&
      typeof flightScene.combatPause.resume === "function"
    ) {
      flightScene.combatPause.resume();
    }
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

    for (let i = 0; i < 2000; i++) {
      this.harness.tick(50);
      await Promise.resolve(); // yield so async performWarp() can settle
      if (engine.player?.currentSystemId !== sys0) break;
      // If the turn ended mid-flight (ship stopped without reaching the edge) and
      // no active combat blocks it, restart the route.
      if (
        !flightScene?.isTurnRunning &&
        !flightScene?.combatPause?.paused &&
        typeof flightScene?.onPlayPause === "function"
      ) {
        flightScene.onPlayPause();
      }
    }
  }

  /**
   * Run a real course-less **wait turn** over the live flight scene so one galaxy
   * DAY passes — the headless equivalent of pressing «ХОД» with no plotted route.
   * `onPlayPause` starts the wait (`isTurnRunning`, ship stationary), a tick of
   * `MS_PER_WAIT_DAY` (1000 ms) crosses exactly one day boundary
   * (`advanceWaitTime` → `advanceGalaxyDay`), then `endTurn` returns to a decision
   * point. Outside flight (or with no turn seam — e.g. a partial test stub) it
   * degrades to a plain frame so the loop is always safe. Private scene methods are
   * reached by a structural cast, the same pattern the warp applier uses.
   *
   * Combat handling: if an NPC engages mid-wait, the combat-pause controller freezes
   * everything (no weapons fire on either side). This method clears the pause before
   * each tick so the fight actually resolves — both player and NPC fire for the tick
   * window, and the engagement ends naturally via `onCombatEnded`. Without this the
   * headless engine would sit frozen indefinitely and no day would ever advance.
   */
  private waitOneDay(): void {
    const engine = this.harness.engine;
    const scene = this.harness.currentScene() as unknown as {
      onPlayPause?(): void;
      endTurn?(): void;
      isTurnRunning?: boolean;
      combatPause?: { paused?: boolean; resume?(): void } | null;
      combatModule?: { isActive?: boolean } | null;
    } | null;
    if (
      engine.currentSceneType !== SceneType.SPACE_FLIGHT ||
      typeof scene?.onPlayPause !== "function"
    ) {
      this.harness.tick();
      return;
    }
    const day0 = engine.galaxy?.gameDays ?? 0;
    if (!scene.isTurnRunning) scene.onPlayPause(); // start the course-less wait
    // Tick budget: 4 × 1000 ms covers the combatFireIntervalMs (2500 ms).
    // Exit early only when a day has passed AND combat is NOT active — the
    // non-combat "wait one day" case. When combat is active (NPC initiated in
    // npcManager.update, which runs AFTER updateShip/advanceWaitTime in the
    // same frame), continue ticking so fire timers accumulate past 2500 ms even
    // though the day already advanced in the first tick.
    for (let i = 0; i < 4; i++) {
      // Un-pause before each tick so weapons fire (combat resolves rather than freezing).
      if (
        scene.combatPause?.paused &&
        typeof scene.combatPause.resume === "function"
      ) {
        scene.combatPause.resume();
      }
      this.harness.tick(1000);
      // Stop once a day has passed AND we are not in an active fight.
      const dayAdvanced = (engine.galaxy?.gameDays ?? 0) > day0;
      const inCombat = scene.combatModule?.isActive === true;
      if (dayAdvanced && !inCombat) break;
    }
    if (scene.isTurnRunning && typeof scene.endTurn === "function") {
      scene.endTurn();
    }
  }

  /**
   * Fly a REAL route across the system so the ship traverses space and the
   * calendar advances (every `pixelsPerDay` px = 1 day). Plots a course toward the
   * star (a safe interior point), stopping a ring short so it never flies into the
   * sun, then ticks the turn until a day passes or the ship arrives. Degrades to a
   * {@link waitOneDay} if the route seam is unavailable, so time still advances.
   */
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
      // Already near the centre — head outward for a long traverse instead.
      tx = physics.shipX - (dx / dist) * 700;
      ty = physics.shipY - (dy / dist) * 700;
    }
    const day0 = engine.galaxy?.gameDays ?? 0;
    scene.executeRouteTo(tx, ty);
    // Run the turn: tick until a day passes or the ship reaches the waypoint.
    for (let i = 0; i < 800; i++) {
      this.harness.tick();
      if ((engine.galaxy?.gameDays ?? 0) > day0) break;
      if (!physics.isMoving) break;
    }
  }
}
