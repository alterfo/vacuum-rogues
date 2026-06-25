/**
 * Letsplay engine — the neural-policy seam (dev-only **stub**).
 *
 * `NeuralPolicy` is the "нейросеть думает за игрока" brain: the trained player
 * net that, once it exists, replaces {@link HeuristicPolicy} behind the identical
 * {@link PlayerPolicy} contract. The training + ONNX export is **Post-Completion**
 * (offline self-play on the RTX 4090), so today this is a documented stub that
 * keeps the heuristic as the default while pinning down the seam:
 *
 *  1. **`featurize(obs)`** — a pure, fixed-length numeric feature vector from the
 *     {@link Observation}, the net's input. Deterministic (same obs → same vector)
 *     and stable-width, so it doubles as the encoder for self-play training data.
 *  2. **`mapNetOutputToAction(scores, obs)`** — a pure mapping from the net's
 *     output head (one score per {@link ACTION_ORDER} slot) onto a **legal**
 *     {@link Action}: the highest-scoring action whose `kind` ∈ `obs.legalActions`,
 *     with `"wait"` (always legal) as the guaranteed floor. So even a net that
 *     argmaxes to an action the current scene can't perform yields a legal move —
 *     the policy can never hand the agent an illegal action.
 *  3. **`load()`** — pulls onnxruntime-web through a **dev-only dynamic
 *     `import()`** (never a static edge — `letsplayDevOnly.test.ts` bans
 *     `import … from "onnxruntime-web"` so the runtime is not added to the prod
 *     bundle) and creates the session. With **no `modelPath`** it throws
 *     "not trained yet", and `decide` stays inert, falling back to the heuristic.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module.
 */
import { GameSystemException } from "@/exceptions/GameSystemException";
import {
  ACTION_ORDER,
  type Observation,
  type PlayerActionKind,
} from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { HeuristicPolicy } from "./HeuristicPolicy";

/**
 * Minimal structural shapes of the onnxruntime-web pieces the seam touches,
 * declared **locally** so there is no static `import … from "onnxruntime-web"`
 * edge (the guard test bans it). Only the dev-only dynamic `import()` in
 * {@link NeuralPolicy.load} ever pulls the real runtime.
 */
interface OrtTensorLike {
  readonly data: ArrayLike<number>;
}
interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
}
interface OrtTensorCtor {
  new (type: string, data: Float32Array, dims: number[]): unknown;
}
interface OrtModuleLike {
  InferenceSession: { create(path: string): Promise<OrtSessionLike> };
  Tensor: OrtTensorCtor;
}

/** Construction options for {@link NeuralPolicy}. */
export interface NeuralPolicyOptions {
  /**
   * Path / URL to the exported ONNX player net. **Absent ⇒ inert**: `load()`
   * throws "not trained yet" and `decide` falls back to {@link fallback}.
   */
  readonly modelPath?: string;
  /** Decision used while no net is loaded. Defaults to a {@link HeuristicPolicy}. */
  readonly fallback?: PlayerPolicy;
  /** Net input feed name (the exported graph's input). Defaults to `"obs"`. */
  readonly inputName?: string;
  /** Net output name (the action-score head). Defaults to `"scores"`. */
  readonly outputName?: string;
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
 * The neural player. Inert until a trained net is loaded — construct it, call
 * `await load()` (which throws "not trained yet" with no `modelPath`), then it
 * decides from the net; otherwise `decide` defers to the heuristic baseline so
 * the agent loop keeps running. Honours the {@link PlayerPolicy} contract today
 * (sync `decide`, never throws, always a legal action) via that fallback.
 */
export class NeuralPolicy implements PlayerPolicy {
  readonly name = "neural";

  private readonly fallback: PlayerPolicy;
  private readonly inputName: string;
  private readonly outputName: string;
  private session: OrtSessionLike | null = null;
  private ort: OrtModuleLike | null = null;
  /** Scores from the most recent {@link think}, consumed by the next `decide`. */
  private lastScores: number[] | null = null;

  constructor(private readonly options: NeuralPolicyOptions = {}) {
    this.fallback = options.fallback ?? new HeuristicPolicy();
    this.inputName = options.inputName ?? "obs";
    this.outputName = options.outputName ?? "scores";
  }

  /** True once a trained net has been loaded via {@link load}. */
  get isLoaded(): boolean {
    return this.session !== null;
  }

  /**
   * Load the trained player net through a **dev-only dynamic import** of
   * onnxruntime-web. Throws a {@link GameSystemException} ("not trained yet")
   * when no `modelPath` is configured — the export pipeline is Post-Completion,
   * so until then the policy stays inert and {@link decide} falls back.
   */
  async load(): Promise<void> {
    const modelPath = this.options.modelPath;
    if (!modelPath) {
      throw new GameSystemException(
        "LETSPLAY_NEURAL_NOT_TRAINED",
        "NeuralPolicy.load: not trained yet — no model path configured. Train " +
          "and export the player net offline (see plan Post-Completion) and " +
          "pass { modelPath }; until then the HeuristicPolicy remains the default.",
      );
    }
    // DEV-ONLY dynamic import: never a static edge, so the prod bundle never
    // pulls onnxruntime-web (guarded by letsplayDevOnly.test.ts).
    const ort = (await import("onnxruntime-web")) as unknown as OrtModuleLike;
    this.session = await ort.InferenceSession.create(modelPath);
    this.ort = ort;
  }

  /**
   * Run the loaded net for `obs`, caching the action-score vector the next
   * {@link decide} will map. Async (ONNX inference); a no-op returning `null`
   * when no net is loaded. Separated from the sync `decide` because ONNX
   * inference is asynchronous — the agent loop primes with `think` then decides.
   */
  async think(obs: Observation): Promise<readonly number[] | null> {
    if (!this.session || !this.ort) return null;
    const feats = featurize(obs);
    const input = new this.ort.Tensor("float32", Float32Array.from(feats), [
      1,
      feats.length,
    ]);
    const out = await this.session.run({ [this.inputName]: input });
    const tensor = out[this.outputName] ?? Object.values(out)[0];
    this.lastScores = tensor ? Array.from(tensor.data, Number) : null;
    return this.lastScores;
  }

  /**
   * Choose one legal action. With a net loaded and a primed score vector, maps
   * the net output to a legal action; otherwise inert — defers to the heuristic
   * baseline (so the contract "never throws, always legal" holds even untrained).
   */
  decide(obs: Observation): Action {
    if (this.isLoaded && this.lastScores) {
      return mapNetOutputToAction(this.lastScores, obs);
    }
    return this.fallback.decide(obs);
  }
}
