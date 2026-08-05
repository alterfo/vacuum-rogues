import type { Galaxy } from "./Galaxy";
import type { Player } from "./Player";
import type { DialogueSession } from "./DialogueSession";
import type { BankingSnapshot } from "./banking/Ledger";
import type {
  SerializedSave,
  ShipLoadoutSnapshot,
  LoadoutPreset,
} from "@/types";
import type { SceneType } from "@/types";

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
    public loadout?: ShipLoadoutSnapshot,
    public banking?: BankingSnapshot,
    public flightShipPos?: FlightShipPos,
    public campaignPeakPower?: number,
    public loadoutPresets?: LoadoutPreset[],
    public autopilotEngaged?: boolean,
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
        campaignPeakPower: this.campaignPeakPower,
        loadoutPresets: this.loadoutPresets,
        autopilotEngaged: this.autopilotEngaged,
      }),
    };
  }

  static deserialize(data: SerializedSave): SaveState {
    const parsed = JSON.parse(data.payload);
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
      parsed.campaignPeakPower,
      parsed.loadoutPresets,
      parsed.autopilotEngaged,
    );
  }
}
