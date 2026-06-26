import type { TrackKey } from "@/systems/AudioManager";
import { SceneType } from "@/types";

/**
 * Pure music director: maps the current game/combat state to the background
 * music {@link TrackKey} that *should* be playing. It is the single source of
 * truth for "which track fits right now" — the AudioManager driver polls
 * {@link MusicDirector.desiredTrack} and only swaps when the value changes
 * (AudioManager.playTrack is a no-op for the already-playing track).
 *
 * The only stateful part is a short combat **hysteresis**: once a fight engages
 * the combat track is held for {@link COMBAT_HOLD_MS} after it disengages, so a
 * brief skirmish (engage → disengage → re-engage) doesn't thrash the cross-fade
 * back to ambient and immediately into combat again.
 */
export interface MusicContext {
  /** True while a fight is actively engaged. */
  inCombat: boolean;
  /** The current scene. */
  scene: SceneType;
  /** True when the player's hull is critically low (drives a tension cue). */
  lowHull?: boolean;
  /** True when the active fight is a boss (Overmind core) encounter. */
  boss?: boolean;
  /** Monotonic clock in ms (e.g. performance.now()); injected for testability. */
  now: number;
}

/** How long (ms) combat music persists after a fight disengages before reverting. */
export const COMBAT_HOLD_MS = 4000;

/** Scenes where combat / low-hull tension music can apply (real-time flight). */
const FLIGHT_SCENES: ReadonlySet<SceneType> = new Set([
  SceneType.SPACE_FLIGHT,
  SceneType.STAR_MAP,
]);

/**
 * Ambient track for a scene, mirroring the historical GameEngine.playSceneTrack
 * switch. Returns `null` for scenes that should keep the current track playing
 * (the old `default: break` — e.g. dialogue/inventory/bank overlays).
 */
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
  /** Timestamp (ms, in the injected clock) until which combat music is held. */
  private combatHeldUntil = 0;

  /** Reset hysteresis state (e.g. on new game / engine teardown). */
  reset(): void {
    this.combatHeldUntil = 0;
  }

  /**
   * The track that should be playing for the given context. Pure aside from the
   * combat-hold hysteresis it folds in: combat engages immediately and lingers
   * for {@link COMBAT_HOLD_MS} after disengage. `null` means "leave the current
   * track alone" (no scene track applies).
   */
  desiredTrack(ctx: MusicContext): TrackKey | null {
    const flight = FLIGHT_SCENES.has(ctx.scene);

    // Combat only makes sense in flight; extend the hold window while engaged.
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
