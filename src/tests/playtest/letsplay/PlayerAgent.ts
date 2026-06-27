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

/** One recorded decision in a session transcript. */
export interface AgentStep {
  /** Zero-based step index. */
  readonly index: number;
  /** The scene the decision was made in. */
  readonly scene: SceneType;
  /** The action the policy chose. */
  readonly action: Action;
}

/** The outcome of an agent run — the transcript plus any failures surfaced. */
export interface AgentRunResult {
  /** Every observe→decide step taken, in order. */
  readonly steps: AgentStep[];
  /** The harness error sink (logged errors + global rejections) at run end. */
  readonly errors: RecordedError[];
  /** The scene the agent ended in. */
  readonly endScene: SceneType;
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
    const steps: AgentStep[] = [];
    for (let index = 0; index < budget; index++) {
      const obs = observe(this.harness.engine);
      this.memory = updateMemory(this.memory, obs);
      const action = this.policy.decide(obs, this.memory);
      steps.push({ index, scene: obs.scene, action });
      await this.apply(action, obs);
    }
    return {
      steps,
      errors: this.harness.errors(),
      endScene: this.harness.engine.currentSceneType,
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
