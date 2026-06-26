/**
 * Letsplay engine — shared live-engine query helpers (dev-only).
 *
 * Small, pure projections off the live {@link GameEngine} that both action
 * appliers need: the headless {@link PlayerAgent} (driving the harness) and the
 * live {@link createLiveSceneController} (driving the rendered scene). Keeping
 * them here is the single source of truth, so a fix to how the agent resolves its
 * current system / landed planet / board quests reaches *both* loops at once.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module (enforced
 * by `letsplayDevOnly.test.ts`).
 */
import type { GameEngine } from "@/systems/GameEngine";
import type { StarSystem } from "@/domain/StarSystem";
import type { Planet } from "@/domain/Planet";

/** Resolve the player's current star system from the live engine, if any. */
export function currentSystem(engine: GameEngine): StarSystem | null {
  const player = engine.player;
  const galaxy = engine.galaxy;
  if (!player || !galaxy) return null;
  return galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;
}

/** The planet the player is presently landed on, if resolvable. */
export function landedPlanet(engine: GameEngine): Planet | null {
  const sys = currentSystem(engine);
  const landedId = engine.player?.landedPlanetId;
  if (!sys || !landedId) return null;
  return sys.planets.find((p) => p.id === landedId) ?? null;
}

/**
 * Accept every contract offered on the landed planet that is *registered* as a
 * template and not already active. Guarding on the registered template + the
 * active set keeps this a clean no-op (never a `logger.error`) when there is
 * nothing new to take.
 */
export function acceptBoardQuests(engine: GameEngine): void {
  const planet = landedPlanet(engine);
  if (!planet) return;
  const quests = engine.questManager;
  const active = new Set(quests.getActiveQuests().map((q) => q.id));
  for (const offered of planet.availableQuests) {
    if (active.has(offered.id)) continue;
    if (!quests.getQuestTemplate(offered.id)) continue; // not registered ⇒ skip
    quests.acceptQuest(offered.id, planet.id);
  }
}
