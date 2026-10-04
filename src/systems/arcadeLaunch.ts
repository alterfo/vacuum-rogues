import type { GameEngine } from "@/systems/GameEngine";
import { FactionType, SceneType } from "@/types";

export interface ArcadeLaunchRequest {
  startLevel: number;
  freshGame: boolean;
}

export function parseArcadeLaunch(search: string): ArcadeLaunchRequest | null {
  const params = new URLSearchParams(search);
  if (!params.has("arcade")) return null;
  const raw = Number(params.get("arcade") || params.get("level") || 1);
  const startLevel = Number.isFinite(raw)
    ? Math.min(50, Math.max(1, Math.floor(raw)))
    : 1;
  return { startLevel, freshGame: params.has("game") };
}

export async function launchArcadeFromQuery(
  engine: GameEngine,
  search: string,
): Promise<boolean> {
  const request = parseArcadeLaunch(search);
  if (request === null) return false;

  if (request.freshGame) {
    await engine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: engine,
      selectedFaction: FactionType.OUTLANDERS,
      selectedGameMode: "NORMAL",
    });
  }
  const systemId = engine.player?.currentSystemId;
  await engine.transitionTo(SceneType.BLACK_HOLE_ARCADE, {
    gameEngine: engine,
    returnSystemId: systemId,
    blackHoleSystemId: systemId,
    startLevel: request.startLevel,
  });
  return true;
}
