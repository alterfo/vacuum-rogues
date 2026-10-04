import { createEnemy } from "@/systems/blackHoleArcade/arcadeEnemies";
import { createArcadeRun } from "@/systems/blackHoleArcade/arcadeState";
import {
  ARCADE_IDLE_INPUT,
  type ArcadeEnemy,
  type ArcadeEnemyTypeId,
  type ArcadeInput,
  type ArcadeRunState,
} from "@/systems/blackHoleArcade/arcadeTypes";

export const IDLE: ArcadeInput = ARCADE_IDLE_INPUT;

export function holdRun(
  options: { seed?: number; startLevel?: number } = {},
): ArcadeRunState {
  const state = createArcadeRun({ seed: 7, ...options });
  state.plan = {
    ...state.plan,
    spawns: [
      {
        atMs: 1e9,
        type: "scout",
        x: 0,
        variant: 0,
        param: 0,
        dir: 1,
        drop: null,
      },
    ],
  };
  state.player.invulnMs = 0;
  return state;
}

export function addEnemy(
  state: ArcadeRunState,
  type: ArcadeEnemyTypeId,
  x: number,
  y: number,
  overrides: Partial<ArcadeEnemy> = {},
): ArcadeEnemy {
  const enemy = createEnemy(
    state.nextId++,
    { atMs: 0, type, x, variant: 0, param: 0, dir: 1, drop: null },
    state.level,
    y,
  );
  enemy.x = x;
  enemy.y = y;
  Object.assign(enemy, overrides);
  state.enemies.push(enemy);
  return enemy;
}

export function fire(extra: Partial<ArcadeInput> = {}): ArcadeInput {
  return { ...IDLE, firing: true, ...extra };
}
