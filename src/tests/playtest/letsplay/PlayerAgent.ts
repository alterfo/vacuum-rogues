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
} from "./engineQueries";

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
    switch (action.kind) {
      case "wait":
        // A real wait turn so a galaxy DAY actually passes (markets / NPC sim /
        // quests / Overmind all advance) — the agent's biggest gap was never
        // advancing time. Degrades to a plain frame outside flight.
        this.waitOneDay();
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
        const planet =
          sys?.planets.find((p) => p.id === action.targetId) ?? sys?.planets[0];
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
        // The market opens off a planet; from inside the market there is no
        // executor yet, so a tick keeps the loop safe.
        const planet =
          landedPlanet(engine) ?? currentSystem(engine)?.planets[0];
        if (obs.scene === SceneType.PLANET && planet)
          await this.harness.goTo(SceneType.TRADE, { planet });
        else this.harness.tick();
        return;
      }

      case "take-quest": {
        acceptBoardQuests(engine);
        this.harness.tick();
        return;
      }

      case "warp": {
        // Two-step real warp: open the galaxy map, then jump to a neighbour.
        if (obs.scene !== SceneType.STAR_MAP) {
          await this.harness.goTo(SceneType.STAR_MAP);
          return;
        }
        const target = currentSystem(engine)?.connections[0]?.toSystemId;
        const scene = this.harness.currentScene() as {
          performWarpJumpTo?: (id: string) => Promise<void>;
        } | null;
        if (target && typeof scene?.performWarpJumpTo === "function")
          await scene.performWarpJumpTo(target);
        else this.harness.tick();
        return;
      }

      // Combat + repair are owned by their own modules (CombatModule / station
      // UI); at the agent level they degrade to a safe frame advance.
      case "attack":
      case "flee":
      case "repair":
      default:
        this.harness.tick();
        return;
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
   */
  private waitOneDay(): void {
    const engine = this.harness.engine;
    const scene = this.harness.currentScene() as unknown as {
      onPlayPause?(): void;
      endTurn?(): void;
      isTurnRunning?: boolean;
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
    // One wait-day is MS_PER_WAIT_DAY (1000 ms); a few large ticks cross it.
    for (let i = 0; i < 4 && (engine.galaxy?.gameDays ?? 0) === day0; i++) {
      this.harness.tick(1000);
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
