/**
 * Letsplay engine — the neural-policy seam (dev-only).
 *
 * `NeuralPolicy` is the "нейросеть думает за игрока" brain: the trained player
 * net that, once it exists, replaces {@link HeuristicPolicy} behind the identical
 * {@link PlayerPolicy} contract. The training run is **Post-Completion** (offline
 * self-play / behavioural cloning on the RTX 4090), so until a `*.weights.json`
 * is dropped in the policy stays inert (the heuristic is the default); the seam
 * is fully pinned down meanwhile:
 *
 *  1. **`featurize(obs, memory?)`** — a pure, fixed-length numeric feature vector
 *     from the {@link Observation} plus the agent's {@link AgentMemory} belief
 *     block, the net's input. Deterministic (same `(obs, memory)` → same vector)
 *     and stable-width, so it doubles as the encoder for self-play training data.
 *  2. **`forward(weights, feats)`** — the hand-written pure-TS MLP forward pass
 *     ({@link forward} in `mlp.ts`): two tiny matmuls + ReLU, microseconds on the
 *     CPU, no wasm runtime / worker / GPU. It replaces the former
 *     `onnxruntime-web` inference session — the net is just a small weights JSON.
 *  3. **`mapNetOutputToAction(scores, obs)`** — a pure mapping from the net's
 *     output head (one score per {@link ACTION_ORDER} slot) onto a **legal**
 *     {@link Action}: the highest-scoring action whose `kind` ∈ `obs.legalActions`,
 *     with `"wait"` (always legal) as the guaranteed floor. So even a net that
 *     argmaxes to an action the current scene can't perform yields a legal move —
 *     the policy can never hand the agent an illegal action.
 *  4. **`load()`** — adopts and validates the trained {@link MlpWeights} JSON
 *     (`loadWeights` + a feature/action-width check). With **no `weights`** it
 *     throws "not trained yet", and `decide` stays inert, falling back to the
 *     heuristic. There is no ONNX runtime and no dynamic `import()` any more.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module.
 */
import { GameSystemException } from "@/exceptions/GameSystemException";
import { GameValidationException } from "@/exceptions/GameValidationException";
import { SceneType } from "@/types";
import {
  ACTION_ORDER,
  type Observation,
  type PlayerActionKind,
} from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { HeuristicPolicy } from "./HeuristicPolicy";
import { forward, loadWeights, type MlpWeights } from "./mlp";
import type { AgentMemory } from "./AgentMemory";
import { memoryFeatures, MEMORY_FEATURE_LENGTH } from "./memoryFeatures";

/** Construction options for {@link NeuralPolicy}. */
export interface NeuralPolicyOptions {
  /**
   * The trained player net's weights — the parsed `*.weights.json`
   * ({@link MlpWeights} JSON shape, validated by `loadWeights`). **Absent ⇒
   * inert**: `load()` throws "not trained yet" and `decide` falls back to
   * {@link fallback}. Drop the exported weights here (dev-only) once trained.
   */
  readonly weights?: unknown;
  /** Decision used while no net is loaded. Defaults to a {@link HeuristicPolicy}. */
  readonly fallback?: PlayerPolicy;
}

/** Number of observation-derived features (the egocentric vitals/system block). */
export const OBS_FEATURE_LENGTH = 30;

/**
 * Number of campaign-difficulty features appended after the memory block
 * (three-year-campaign Task 10): the adaptive signals the `MemoryHeuristicPolicy`
 * teacher reasons over — power index, battle-ready, hops-to-front, arm-up cost.
 * **Appended at the tail** (indices 50–53), *after* the memory block, so the
 * historical 0–49 feature layout (obs 0–29 + memory 30–49) is byte-stable: the
 * shipped 16→18 weights were zero-extended by appending 4 input columns + 2
 * output rows, which only works if the first 50 features keep their positions.
 */
export const CAMPAIGN_FEATURE_LENGTH = 4;

/**
 * Length of the {@link featurize} vector — the net's input width: the
 * observation block ({@link OBS_FEATURE_LENGTH}) + the belief-derived memory
 * block ({@link MEMORY_FEATURE_LENGTH}) + the campaign block
 * ({@link CAMPAIGN_FEATURE_LENGTH}). **Growing any block changes the MLP input
 * width** — retrain + re-export the player net's weights JSON at the new width
 * (Post-Completion; `load()` rejects a width mismatch).
 */
export const FEATURE_LENGTH =
  OBS_FEATURE_LENGTH + MEMORY_FEATURE_LENGTH + CAMPAIGN_FEATURE_LENGTH;

/** Clamp `n / denom` into `[0, 1]` — a saturating count/ratio normaliser. */
function norm(n: number, denom: number): number {
  if (denom <= 0) return 0;
  const v = n / denom;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Project an {@link Observation} (and the agent's {@link AgentMemory} belief state)
 * into a fixed-length numeric feature vector (the net's input): a
 * {@link OBS_FEATURE_LENGTH}-wide egocentric block (12 vitals/system features +
 * 9 scene-type one-hot bits + 1 warp-in-transit bit + 8 Task-5 bank/equipment/
 * Overmind/quest-delivery signals), then the {@link MEMORY_FEATURE_LENGTH}-wide
 * belief block ({@link memoryFeatures}), then the {@link CAMPAIGN_FEATURE_LENGTH}-
 * wide campaign block (Task 10: power index, battle-ready, hops-to-front, arm-up
 * cost). Pure and deterministic — the same `(obs, memory)` always yields the exact
 * same {@link FEATURE_LENGTH}-wide vector, every component already in `[0, 1]` so it
 * needs no further scaling. Player-less observations (menus) encode as all-zero
 * vitals; with **no memory** the belief block degrades to its sane zero defaults
 * (the agent "knows nothing yet"), so callers without a notebook still get a
 * full-width vector.
 */
export function featurize(obs: Observation, memory?: AgentMemory): number[] {
  const p = obs.player;
  const sys = obs.system;
  const availableQuests =
    obs.currentPlanet?.availableQuests ??
    sys?.planets.reduce((max, q) => Math.max(max, q.availableQuests), 0) ??
    0;

  return [
    obs.hasPlayer ? 1 : 0,
    p?.hullFraction ?? 0,
    p?.fuelFraction ?? 0,
    p && p.cargoCapacity > 0 ? norm(p.cargoUsed, p.cargoCapacity) : 0,
    norm(p?.credits ?? 0, 100_000),
    norm(sys?.planets.length ?? 0, 8),
    norm(sys?.stations.length ?? 0, 8),
    norm(sys?.connections ?? 0, 8),
    norm(obs.hostiles.length, 8),
    norm(availableQuests, 8),
    norm(obs.quests.length, 8),
    norm(obs.legalActions.length, ACTION_ORDER.length),
    // Scene-type one-hot bits (indices 12–20): help the net discriminate which
    // actions are meaningful in the current scene without memorising the legal-
    // action mask alone. Covers every scene the Task 2 action vocabulary acts in.
    obs.scene === SceneType.SPACE_FLIGHT ? 1 : 0,
    obs.scene === SceneType.PLANET ? 1 : 0,
    obs.scene === SceneType.STAR_MAP ? 1 : 0,
    obs.scene === SceneType.STATION ? 1 : 0,
    obs.scene === SceneType.EQUIPMENT_SHOP ? 1 : 0,
    obs.scene === SceneType.BANK ? 1 : 0,
    obs.scene === SceneType.TRADE ? 1 : 0,
    obs.scene === SceneType.TEXT_QUEST ? 1 : 0,
    obs.scene === SceneType.GAME_OVER ? 1 : 0,
    // Warp-in-transit signal: 1 while the ship is flying to the system edge for a
    // pending hyperjump. The policy should wait rather than re-opening StarMap
    // (which cancels the warp). Lives in the observation block because it comes
    // from the live SpaceFlightScene state, not the agent's belief notebook.
    obs.warpInTransit ? 1 : 0,
    // Task 5 bank/equipment/Overmind/quest-delivery block (indices 22–29) — the
    // Task 1 observation signals, each already egocentric + null-safe on `obs`.
    obs.hasCraftCenter ? 1 : 0,
    obs.hasBank ? 1 : 0,
    obs.activeLoans ? 1 : 0,
    obs.questDeliveryHere ? 1 : 0,
    obs.overmindShare ?? 0,
    obs.nearOvermindCore ? 1 : 0,
    norm(obs.cheapestGearPrice ?? 0, 10_000),
    norm(obs.questsCompleted ?? 0, 20),
    ...memoryFeatures(obs, memory),
    // Campaign block (indices 50–53, Task 10) — the adaptive-difficulty signals
    // the teacher reasons over, appended AFTER the memory block so the 0–49
    // layout stays byte-stable for the zero-extended 16→18 shipped weights.
    obs.playerPowerIndex ?? 0, // already ∈ [0,1]
    obs.battleReady ? 1 : 0,
    // Hops to the nearest Overmind front: 0 = standing at the front, → 1 far;
    // absent (no front yet / systemless) reads as maximally-far.
    obs.hopsToOvermindFront == null ? 1 : norm(obs.hopsToOvermindFront, 10),
    norm(obs.armUpCost ?? 0, 10_000),
  ];
}

/**
 * Resolve a concrete `targetId` for a chosen neural `kind` from the observation.
 *
 * The net's output head only selects an action **kind** (18 slots) — it does not
 * name a target. The appliers resolve most targets themselves (warp →
 * `pickWarpTarget`, dock → first station, trade → landed/first planet), but
 * `land` is the one action with **no applier fallback**: `PlayerAgent.apply`'s
 * `land` case lands *only* on the exact `action.targetId` planet (a deliberate
 * guard against spin-landing an uninhabited planet — see its comment), so a
 * bare `{kind:"land"}` teleport-lands nowhere and the agent stalls in a
 * land→no-op→land loop (the neural net can never actually land). Fill that gap
 * here: prefer a **habitable** in-system planet (has a market — where the
 * teacher lands to earn/refuel), falling back to the first planet only if none
 * is flagged habitable. Pure and deterministic (same `obs` ⇒ same target); other
 * kinds keep the applier's own resolution. Returns `undefined` when nothing in
 * the observation fits (the applier then no-op-ticks, exactly as before).
 */
function resolveNeuralTarget(
  kind: PlayerActionKind,
  obs: Observation,
): string | undefined {
  if (kind !== "land") return undefined;
  const planets = obs.system?.planets ?? [];
  return (planets.find((p) => p.isHabitable) ?? planets[0])?.id;
}

/**
 * Map a net output (one score per {@link ACTION_ORDER} slot) onto a **legal**
 * {@link Action}: rank the action vocabulary by descending score and return the
 * first whose `kind` is in `obs.legalActions`. `"wait"` is legal in every scene,
 * so the result is always legal even when the net's argmax is an action the
 * current scene can't perform (or `scores` is short / empty). A concrete
 * `targetId` is attached for kinds that need one but have no applier fallback
 * (see {@link resolveNeuralTarget}) so the chosen action actually executes.
 * Pure; never throws.
 */
export function mapNetOutputToAction(
  scores: readonly number[],
  obs: Observation,
): Action {
  const legal = new Set<PlayerActionKind>(obs.legalActions);
  const ranked = ACTION_ORDER.map((kind, i) => ({
    kind,
    score: Number.isFinite(scores[i]) ? scores[i] : -Infinity,
  })).sort((a, b) => b.score - a.score);
  const kind = ranked.find((r) => legal.has(r.kind))?.kind ?? "wait";
  const targetId = resolveNeuralTarget(kind, obs);
  return targetId
    ? { kind, targetId, reason: "neural" }
    : { kind, reason: "neural" };
}

/**
 * The neural player. Inert until a trained net is loaded — construct it with the
 * exported weights, call `await load()` (which throws "not trained yet" with no
 * `weights`), then it decides by running the pure-TS MLP; otherwise `decide`
 * defers to the heuristic baseline so the agent loop keeps running. Honours the
 * {@link PlayerPolicy} contract today (sync `decide`, never throws, always a legal
 * action) via that fallback — and, once loaded, via the strict load-time
 * validation that the weights match `featurize` width / {@link ACTION_ORDER}.
 */
export class NeuralPolicy implements PlayerPolicy {
  readonly name = "neural";

  private readonly fallback: PlayerPolicy;
  private weights: MlpWeights | null = null;

  constructor(private readonly options: NeuralPolicyOptions = {}) {
    this.fallback = options.fallback ?? new HeuristicPolicy();
  }

  /** True once a trained net has been loaded via {@link load}. */
  get isLoaded(): boolean {
    return this.weights !== null;
  }

  /**
   * Adopt the trained player net's weights. Validates the {@link MlpWeights}
   * shape (`loadWeights`) and that the net matches this policy's I/O — the first
   * layer takes a {@link FEATURE_LENGTH}-wide input and the output head has one
   * score per {@link ACTION_ORDER} slot — so {@link decide}'s `forward` can never
   * throw on a width mismatch. Throws a {@link GameSystemException} ("not trained
   * yet") when no `weights` are configured (the export is Post-Completion, so
   * until then the policy stays inert and {@link decide} falls back), or a
   * {@link GameValidationException} when the weights are malformed / mis-sized.
   */
  async load(): Promise<void> {
    const raw = this.options.weights;
    if (raw === undefined || raw === null) {
      throw new GameSystemException(
        "LETSPLAY_NEURAL_NOT_TRAINED",
        "NeuralPolicy.load: not trained yet — no weights configured. Train and " +
          "export the player net offline (see plan Post-Completion) and pass " +
          "{ weights }; until then the HeuristicPolicy remains the default.",
      );
    }
    const weights = loadWeights(raw);
    const inDim = weights.layers[0].W[0]?.length ?? 0;
    if (inDim !== FEATURE_LENGTH) {
      throw new GameValidationException(
        "LETSPLAY_NEURAL_INPUT_WIDTH",
        `NeuralPolicy.load: net input width ${inDim} != featurize width ${FEATURE_LENGTH}`,
        { inputWidth: inDim, expected: FEATURE_LENGTH },
      );
    }
    const outDim = weights.layers[weights.layers.length - 1].W.length;
    if (outDim !== ACTION_ORDER.length) {
      throw new GameValidationException(
        "LETSPLAY_NEURAL_OUTPUT_WIDTH",
        `NeuralPolicy.load: net output width ${outDim} != action count ${ACTION_ORDER.length}`,
        { outputWidth: outDim, expected: ACTION_ORDER.length },
      );
    }
    this.weights = weights;
  }

  /**
   * Choose one legal action. With a net loaded, runs `featurize → forward →
   * mapNetOutputToAction` over the pure-TS MLP — feeding the agent's
   * {@link AgentMemory} belief block into {@link featurize} so the net sees the
   * memory-derived features it was trained on; otherwise inert — defers to the
   * heuristic baseline (so the contract "never throws, always legal" holds even
   * untrained; the baseline is memoryless, so the notebook isn't forwarded to it).
   * Synchronous: the MLP forward is a couple of CPU matmuls.
   */
  decide(obs: Observation, memory?: AgentMemory): Action {
    if (this.weights) {
      const scores = forward(this.weights, featurize(obs, memory));
      return mapNetOutputToAction(scores, obs);
    }
    return this.fallback.decide(obs);
  }
}
