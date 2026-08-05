import type { Player } from "@/domain/Player";
import type { SceneType } from "@/types";
import type { BankAccess } from "@/systems/banking/economy";
import type { BankBus } from "@/systems/banking/bus";
import type { BankingService } from "@/systems/banking/BankingService";

export interface BankSceneHost {
  readonly bankBus: BankBus;
  readonly bankingService: BankingService;
  readonly bank: BankAccess;
  readonly player: Player | null;
  transitionTo(sceneType: SceneType, context?: object): Promise<void>;
}
