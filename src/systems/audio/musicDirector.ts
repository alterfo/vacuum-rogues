import type { TrackKey } from "@/systems/AudioManager";
import { SceneType } from "@/types";

export interface MusicContext {
  inCombat: boolean;
  scene: SceneType;
  lowHull?: boolean;
  boss?: boolean;
  now: number;
}

export const COMBAT_HOLD_MS = 4000;

const FLIGHT_SCENES: ReadonlySet<SceneType> = new Set([
  SceneType.SPACE_FLIGHT,
  SceneType.STAR_MAP,
]);

export function sceneTrack(scene: SceneType): TrackKey | null {
  switch (scene) {
    case SceneType.MAIN_MENU:
    case SceneType.RACE_SELECTION:
      return "menu_main";
    case SceneType.STAR_MAP:
    case SceneType.SPACE_FLIGHT:
    case SceneType.INFO_CENTER:
      return "explore_calm";
    case SceneType.PLANET:
      return "planet_hub";
    case SceneType.TRADE:
      return "market";
    case SceneType.EQUIPMENT_SHOP:
    case SceneType.STATION:
      return "equipment_shop";
    case SceneType.GOVERNMENT:
      return "governor_dialogue";
    case SceneType.TEXT_QUEST:
      return "text_quest";
    default:
      return null;
  }
}

export class MusicDirector {
  private combatHeldUntil = 0;

  reset(): void {
    this.combatHeldUntil = 0;
  }

  desiredTrack(ctx: MusicContext): TrackKey | null {
    const flight = FLIGHT_SCENES.has(ctx.scene);

    if (ctx.inCombat && flight) {
      this.combatHeldUntil = ctx.now + COMBAT_HOLD_MS;
    }
    const combatActive = flight && ctx.now < this.combatHeldUntil;

    if (combatActive) {
      return ctx.boss ? "combat_boss" : "combat";
    }

    if (flight && ctx.lowHull) {
      return "tension_low";
    }

    return sceneTrack(ctx.scene);
  }
}
