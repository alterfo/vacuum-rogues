import type { Observation, PlayerActionKind } from "./observe";
import type { AgentMemory } from "./AgentMemory";

export interface Action {
  readonly kind: PlayerActionKind;
  readonly targetId?: string;
  readonly reason?: string;
}

export interface PlayerPolicy {
  readonly name: string;
  decide(obs: Observation, memory?: AgentMemory): Action;
}
