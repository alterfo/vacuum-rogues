import { isNeuralEnabled } from "@/systems/settings/gameSettings";
import type { PlayerPolicy } from "./PlayerPolicy";
import { HeuristicPolicy } from "./HeuristicPolicy";
import { NeuralPolicy } from "./NeuralPolicy";

export interface PolicyGateOptions {
  readonly enabled?: boolean;
  readonly weights?: unknown;
}

export function selectPlayerPolicy(opts: PolicyGateOptions = {}): PlayerPolicy {
  const enabled = opts.enabled ?? isNeuralEnabled();
  if (!enabled) return new HeuristicPolicy();
  const policy = new NeuralPolicy({ weights: opts.weights });
  if (opts.weights !== undefined) {
    void policy.load().catch(() => {});
  }
  return policy;
}
