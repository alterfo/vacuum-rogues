import type {
  IPlayerService,
  PlayerSettings,
} from "@/core/ports/IPlayerService";
import { Player } from "@/domain/Player";
import { PlayerShip } from "@/domain/PlayerShip";
import { Inventory } from "@/domain/Inventory";
import { SkillTree } from "@/domain/SkillTree";
import { RaceRegistry } from "@/systems/RaceRegistry";

/**
 * Mock implementation of IPlayerService for testing.
 * Follows LSP: creates real Player objects but tracks calls.
 */
export class MockPlayerService implements IPlayerService {
  private player: Player | null = null;
  public createCallCount = 0;
  public lastSettings?: PlayerSettings;

  createPlayer(settings: PlayerSettings): Player {
    this.createCallCount++;
    this.lastSettings = settings;

    const race = RaceRegistry.getRace(settings.raceType);
    this.player = new Player(
      "player",
      settings.captainName ?? "Captain",
      race,
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
        race.shipBaseline.hullHP,
        race.shipBaseline.hullHP,
        race.shipBaseline.shields,
        race.shipBaseline.shields,
        race.shipBaseline.energy,
        race.shipBaseline.energy,
        race.shipBaseline.speed,
        race.shipBaseline.evasion,
        race,
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
