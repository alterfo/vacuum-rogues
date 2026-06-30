import type { Player } from "@/domain/Player";
import type { SceneType } from "@/types";
import type { BankAccess } from "@/systems/banking/economy";
import type { BankBus } from "@/systems/banking/bus";
import type { BankingService } from "@/systems/banking/BankingService";

/**
 * The narrow seam BankScene needs from the host engine. Using this interface
 * instead of the concrete GameEngine type breaks the
 * SceneFactory↔BankScene↔GameEngine import cycle (Cycle 1).
 *
 * GameEngine satisfies this interface structurally — no cast needed in SceneFactory.
 */
export interface BankSceneHost {
  readonly bankBus: BankBus;
  readonly bankingService: BankingService;
  readonly bank: BankAccess;
  readonly player: Player | null;
  transitionTo(sceneType: SceneType, context?: object): Promise<void>;
}
