import type { Galaxy } from "./Galaxy";
import type { Player } from "./Player";
import type { DialogueSession } from "./DialogueSession";
import type { BankingSnapshot } from "./banking/Ledger";
import type { SerializedSave, ShipLoadoutSnapshot } from "@/types";
import type { SceneType } from "@/types";

/**
 * Last known in-flight ship position, persisted so a reload resumes the ship
 * where it was instead of edge-spawning. Coordinates are screen-space and
 * system-relative, so `systemId` records which system they belong to — the
 * restore is applied only when it matches the loaded `player.currentSystemId`.
 */
export interface FlightShipPos {
  x: number;
  y: number;
  systemId: string;
}

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
    /**
     * Last known in-flight ship position (system-relative). Carries its own
     * `systemId` so a reload only restores it when the loaded system matches —
     * otherwise the ship falls back to the default edge spawn. Optional and
     * additive: saves made before this existed simply lack it (no version bump).
     * See `GameEngine.saveGame`/`loadGame` and `applyEntrySpawn`.
     */
    public flightShipPos?: FlightShipPos,
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
        flightShipPos: this.flightShipPos,
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
      parsed.flightShipPos,
    );
  }
}
