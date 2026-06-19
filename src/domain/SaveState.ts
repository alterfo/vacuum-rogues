import type { Galaxy } from "./Galaxy";
import type { Player } from "./Player";
import type { DialogueSession } from "./DialogueSession";
import type { BankingSnapshot } from "./banking/Ledger";
import type { SerializedSave, ShipLoadoutSnapshot } from "@/types";
import type { SceneType } from "@/types";

export class SaveState {
  constructor(
    public version: number,
    public galaxy: Galaxy,
    public player: Player,
    public persistentDialogs: DialogueSession[],
    public timestamp: number,
    public currentSceneType?: SceneType,
    /** Canonical GearCatalog loadout — absent in saves made before it was persisted. */
    public loadout?: ShipLoadoutSnapshot,
    /**
     * The АБС core-banking state (accounts + journal + EOD cursors). Absent in
     * saves made before the ledger was persisted — those migrate by re-seeding
     * the player's current account from `player.credits` on load.
     */
    public banking?: BankingSnapshot,
  ) {}

  serialize(): SerializedSave {
    return {
      version: this.version,
      timestamp: this.timestamp,
      payload: JSON.stringify({
        version: this.version,
        galaxy: this.galaxy,
        player: this.player,
        persistentDialogs: this.persistentDialogs,
        timestamp: this.timestamp,
        currentSceneType: this.currentSceneType,
        loadout: this.loadout,
        banking: this.banking,
      }),
    };
  }

  static deserialize(data: SerializedSave): SaveState {
    const parsed = JSON.parse(data.payload);
    // Hydration would reconstruct proper class instances via SaveManager/MigrationPipeline
    return new SaveState(
      parsed.version ?? data.version,
      parsed.galaxy,
      parsed.player,
      parsed.persistentDialogs ?? [],
      parsed.timestamp ?? data.timestamp,
      parsed.currentSceneType,
      parsed.loadout,
      parsed.banking,
    );
  }
}
