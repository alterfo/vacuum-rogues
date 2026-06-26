/**
 * Letsplay engine — the policy seam (dev-only).
 *
 * A {@link PlayerPolicy} is the brain that, given an {@link Observation} of the
 * live game, chooses one {@link Action} for the {@link PlayerAgent} to apply. The
 * seam is deliberately tiny — `decide(obs) → Action` — so two very different
 * brains satisfy it interchangeably:
 *
 *  - {@link HeuristicPolicy} — the memoryless rule-based baseline that ships now.
 *  - `MemoryHeuristicPolicy` — the belief-using teacher: reasons over the agent's
 *    per-run `AgentMemory` (the behavioural-cloning teacher for the net).
 *  - `NeuralPolicy` — the "нейросеть думает за игрока" net: a tiny pure-TS MLP
 *    over a weights JSON (no ONNX runtime, no dynamic `import()`), inert until
 *    trained weights are dropped in.
 *
 * The single hard contract every policy must honour: **`decide` returns an action
 * whose `kind` is in `obs.legalActions`** (never an illegal action for the
 * current scene). It is also pure — `decide` reads the observation and returns;
 * it mutates nothing and never touches the engine directly (only the agent's
 * applier does). Lives under `src/tests/` and is dev-only.
 */
import type { Observation, PlayerActionKind } from "./observe";
import type { AgentMemory } from "./AgentMemory";

/**
 * A chosen player action: the {@link PlayerActionKind} plus optional hints the
 * agent's applier can use to resolve a concrete target (which planet to land on,
 * which system to warp to, which hostile to fire at). `targetId` is the policy's
 * *intent*; the applier may also resolve a target itself from the live engine
 * when the hint is absent, so an action with only a `kind` is always valid.
 */
export interface Action {
  /** Must be a member of the observed `legalActions` for the current scene. */
  readonly kind: PlayerActionKind;
  /** Optional target id (planet / station / system / quest / npc) for the applier. */
  readonly targetId?: string;
  /** Free-form note for the transcript — why the policy chose this. */
  readonly reason?: string;
}

/**
 * The brain interface. A policy observes and decides; it never drives the engine
 * — applying the action is the {@link PlayerAgent}'s job. Implementations must be
 * total (never throw) and legal (the returned `kind` ∈ `obs.legalActions`).
 */
export interface PlayerPolicy {
  /** Stable name for transcripts / reports (e.g. "heuristic", "neural"). */
  readonly name: string;
  /**
   * Choose one legal action for the observed state, optionally informed by the
   * agent's per-run belief state ({@link AgentMemory}). The {@link PlayerAgent}
   * folds each observation into its notebook and passes it here every step, so a
   * memory-using policy ({@link MemoryHeuristicPolicy}) reasons over what it has
   * *seen*; a memoryless one (heuristic) simply ignores the argument. Pure; never
   * throws.
   */
  decide(obs: Observation, memory?: AgentMemory): Action;
}
