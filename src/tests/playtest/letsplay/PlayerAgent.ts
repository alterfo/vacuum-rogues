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
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import type { StarSystem } from "@/domain/StarSystem";
import type { Planet } from "@/domain/Planet";
import { RealEngineHarness, type RecordedError } from "../realEngineHarness";
import { observe, type Observation } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";

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

/** Resolve the player's current star system from the live engine, if any. */
function currentSystem(engine: GameEngine): StarSystem | null {
  const player = engine.player;
  const galaxy = engine.galaxy;
  if (!player || !galaxy) return null;
  return galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;
}

/** The planet the player is presently landed on, if resolvable. */
function landedPlanet(engine: GameEngine): Planet | null {
  const sys = currentSystem(engine);
  const landedId = engine.player?.landedPlanetId;
  if (!sys || !landedId) return null;
  return sys.planets.find((p) => p.id === landedId) ?? null;
}

/**
 * Drives the real engine as the player. Construct with a booted harness and a
 * policy, then `run(budget)`.
 */
export class PlayerAgent {
  constructor(
    private readonly harness: RealEngineHarness,
    private readonly policy: PlayerPolicy,
  ) {}

  /**
   * Play `budget` steps: observe → decide → apply → tick. Returns the transcript
   * plus the harness error sink. Never throws — a thrown applier error is caught
   * by the harness `tick` sink or recorded here as an `unhandled` failure, so the
   * caller asserts on `result.errors` rather than a try/catch.
   */
  async run(budget: number): Promise<AgentRunResult> {
    const steps: AgentStep[] = [];
    for (let index = 0; index < budget; index++) {
      const obs = observe(this.harness.engine);
      const action = this.policy.decide(obs);
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
        this.harness.tick();
        return;

      case "move": {
        // In flight "move" is a frame of flying; on a sub-screen it backs out
        // toward the flight scene (the universal "leave this panel").
        if (obs.scene === SceneType.SPACE_FLIGHT) this.harness.tick();
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
        this.acceptBoardQuests(engine);
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
   * Accept every contract offered on the landed planet that is *registered* as a
   * template and not already active. Guarding on the registered template + the
   * active set keeps this a clean no-op (never a `logger.error`) when there is
   * nothing new to take.
   */
  private acceptBoardQuests(engine: GameEngine): void {
    const planet = landedPlanet(engine);
    if (!planet) return;
    const quests = engine.questManager;
    const active = new Set(quests.getActiveQuests().map((q) => q.id));
    for (const offered of planet.availableQuests) {
      if (active.has(offered.id)) continue;
      if (!quests.getQuestTemplate(offered.id)) continue; // not registered ⇒ skip
      quests.acceptQuest(offered.id, planet.id);
    }
  }
}
