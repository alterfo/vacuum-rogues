import type {
  IPlayerService,
  PlayerSettings,
} from "@/core/ports/IPlayerService";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { FactionRegistry } from "@/systems/FactionRegistry";

export class MockPlayerService implements IPlayerService {
  private player: Player | null = null;
  public createCallCount = 0;
  public lastSettings?: PlayerSettings;

  createPlayer(settings: PlayerSettings): Player {
    this.createCallCount++;
    this.lastSettings = settings;

    const factionBonus = FactionRegistry.getBonus(settings.factionType);
    const hullBonus = factionBonus.shipBonus.armor ?? 1.0;
    const shieldBonus = factionBonus.shipBonus.shield ?? 1.0;
    const speedBonus = factionBonus.shipBonus.speed ?? 1.0;
    this.player = new Player(
      "player",
      settings.captainName ?? "Captain",
      settings.factionType,
      0,
      1,
      new SkillTree([]),
      {},
      { activeQuests: [], completedQuests: [] },
      { entries: [] },
      settings.startingMoney ?? 1000,
      new PlayerShip(
        "Ranger-1",
        "Ranger-1",
        Math.round(100 * hullBonus),
        Math.round(100 * hullBonus),
        Math.round(50 * shieldBonus),
        Math.round(50 * shieldBonus),
        100,
        100,
        1.0 * speedBonus,
        0.8,
        settings.factionType,
      ),
      new Inventory(),
      "",
    );
    return this.player;
  }

  getPlayer(): Player | null {
    return this.player;
  }

  updatePlayer(player: Player): void {
    this.player = player;
  }

  deletePlayer(): void {
    this.player = null;
  }
}
