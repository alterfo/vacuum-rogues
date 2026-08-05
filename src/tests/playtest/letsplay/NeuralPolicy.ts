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

export interface NeuralPolicyOptions {
  readonly weights?: unknown;
  readonly fallback?: PlayerPolicy;
}

export const OBS_FEATURE_LENGTH = 30;

export const CAMPAIGN_FEATURE_LENGTH = 4;

export const FEATURE_LENGTH =
  OBS_FEATURE_LENGTH + MEMORY_FEATURE_LENGTH + CAMPAIGN_FEATURE_LENGTH;

function norm(n: number, denom: number): number {
  if (denom <= 0) return 0;
  const v = n / denom;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

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
    obs.scene === SceneType.SPACE_FLIGHT ? 1 : 0,
    obs.scene === SceneType.PLANET ? 1 : 0,
    obs.scene === SceneType.STAR_MAP ? 1 : 0,
    obs.scene === SceneType.STATION ? 1 : 0,
    obs.scene === SceneType.EQUIPMENT_SHOP ? 1 : 0,
    obs.scene === SceneType.BANK ? 1 : 0,
    obs.scene === SceneType.TRADE ? 1 : 0,
    obs.scene === SceneType.TEXT_QUEST ? 1 : 0,
    obs.scene === SceneType.GAME_OVER ? 1 : 0,
    obs.warpInTransit ? 1 : 0,
    obs.hasCraftCenter ? 1 : 0,
    obs.hasBank ? 1 : 0,
    obs.activeLoans ? 1 : 0,
    obs.questDeliveryHere ? 1 : 0,
    obs.overmindShare ?? 0,
    obs.nearOvermindCore ? 1 : 0,
    norm(obs.cheapestGearPrice ?? 0, 10_000),
    norm(obs.questsCompleted ?? 0, 20),
    ...memoryFeatures(obs, memory),
    obs.playerPowerIndex ?? 0, // already ∈ [0,1]
    obs.battleReady ? 1 : 0,
    obs.hopsToOvermindFront == null ? 1 : norm(obs.hopsToOvermindFront, 10),
    norm(obs.armUpCost ?? 0, 10_000),
  ];
}

function resolveNeuralTarget(
  kind: PlayerActionKind,
  obs: Observation,
): string | undefined {
  if (kind !== "land") return undefined;
  const planets = obs.system?.planets ?? [];
  return (planets.find((p) => p.isHabitable) ?? planets[0])?.id;
}

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

export class NeuralPolicy implements PlayerPolicy {
  readonly name = "neural";

  private readonly fallback: PlayerPolicy;
  private weights: MlpWeights | null = null;

  constructor(private readonly options: NeuralPolicyOptions = {}) {
    this.fallback = options.fallback ?? new HeuristicPolicy();
  }

  get isLoaded(): boolean {
    return this.weights !== null;
  }

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

  decide(obs: Observation, memory?: AgentMemory): Action {
    if (this.weights) {
      const scores = forward(this.weights, featurize(obs, memory));
      return mapNetOutputToAction(scores, obs);
    }
    return this.fallback.decide(obs);
  }
}
