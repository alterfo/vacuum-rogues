/**
 * Letsplay engine — the neural-policy seam (dev-only **stub**).
 *
 * `NeuralPolicy` is the "нейросеть думает за игрока" brain: the trained player
 * net that, once it exists, replaces {@link HeuristicPolicy} behind the identical
 * {@link PlayerPolicy} contract. The training run is **Post-Completion** (offline
 * self-play / behavioural cloning on the RTX 4090), so today this is a documented
 * stub that keeps the heuristic as the default while pinning down the seam:
 *
 *  1. **`featurize(obs)`** — a pure, fixed-length numeric feature vector from the
 *     {@link Observation}, the net's input. Deterministic (same obs → same vector)
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
import {
  ACTION_ORDER,
  type Observation,
  type PlayerActionKind,
} from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { HeuristicPolicy } from "./HeuristicPolicy";
import { forward, loadWeights, type MlpWeights } from "./mlp";

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

/** Length of the {@link featurize} vector — the net's input width. */
export const FEATURE_LENGTH = 12;

/** Clamp `n / denom` into `[0, 1]` — a saturating count/ratio normaliser. */
function norm(n: number, denom: number): number {
  if (denom <= 0) return 0;
  const v = n / denom;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Project an {@link Observation} into a fixed-length numeric feature vector (the
 * net's input). Pure and deterministic — the same observation always yields the
 * exact same {@link FEATURE_LENGTH}-wide vector, every component already in
 * `[0, 1]` so it needs no further scaling. Player-less observations (menus)
 * encode as all-zero vitals.
 */
export function featurize(obs: Observation): number[] {
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
  ];
}

/**
 * Map a net output (one score per {@link ACTION_ORDER} slot) onto a **legal**
 * {@link Action}: rank the action vocabulary by descending score and return the
 * first whose `kind` is in `obs.legalActions`. `"wait"` is legal in every scene,
 * so the result is always legal even when the net's argmax is an action the
 * current scene can't perform (or `scores` is short / empty). Pure; never throws.
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
  return { kind, reason: "neural" };
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
   * mapNetOutputToAction` over the pure-TS MLP; otherwise inert — defers to the
   * heuristic baseline (so the contract "never throws, always legal" holds even
   * untrained). Synchronous: the MLP forward is a couple of CPU matmuls.
   */
  decide(obs: Observation): Action {
    if (this.weights) {
      const scores = forward(this.weights, featurize(obs));
      return mapNetOutputToAction(scores, obs);
    }
    return this.fallback.decide(obs);
  }
}
