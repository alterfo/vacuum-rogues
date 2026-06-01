import type { Galaxy } from "./Galaxy";
import type { Player } from "./Player";
import type { DialogueSession } from "./DialogueSession";
import type { SerializedSave } from "@/types";
import type { SceneType } from "@/types";

export class SaveState {
  constructor(
    public version: number,
    public galaxy: Galaxy,
    public player: Player,
    public persistentDialogs: DialogueSession[],
    public timestamp: number,
    public currentSceneType?: SceneType,
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
    );
  }
}
