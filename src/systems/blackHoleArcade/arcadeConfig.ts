export const ARCADE_FIELD_W = 720;
export const ARCADE_FIELD_H = 1080;
export const ARCADE_TOTAL_LEVELS = 50;
export const ARCADE_MAX_STEP_MS = 16;
export const ARCADE_MAX_FRAME_MS = 100;

export const ARCADE_PLAYER_RADIUS = 12;
export const ARCADE_PLAYER_PICKUP_RADIUS = 46;
export const ARCADE_PLAYER_KEY_SPEED = 560;
export const ARCADE_PLAYER_MARGIN = 28;
export const ARCADE_PLAYER_START_HULL = 100;
export const ARCADE_PLAYER_START_BOMBS = 2;
export const ARCADE_PLAYER_INVULN_MS = 500;
export const ARCADE_SHIELD_REGEN_DELAY_MS = 2500;
export const ARCADE_SHIELD_REGEN_PER_SEC = 8;
export const ARCADE_SHIELD_PICKUP = 40;
export const ARCADE_SHIELD_CAP = 200;
export const ARCADE_ARMOR_STEP = 0.05;
export const ARCADE_ARMOR_CAP = 0.6;
export const ARCADE_PLATING_STEP = 20;
export const ARCADE_HULL_CAP = 300;
export const ARCADE_REPAIR_SMALL = 25;
export const ARCADE_BOMB_CAP = 5;
export const ARCADE_DRONE_CAP = 2;
export const ARCADE_WEAPON_MAX_LEVEL = 5;
export const ARCADE_MAGNET_MS = 10000;
export const ARCADE_MAGNET_SPEED = 900;
export const ARCADE_PICKUP_FALL_SPEED = 95;
export const ARCADE_PICKUP_RADIUS = 18;

export const ARCADE_BOMB_DURATION_MS = 1800;
export const ARCADE_BOMB_DPS = 260;
export const ARCADE_BOMB_BOSS_SHARE = 0.3;

export const ARCADE_OFFSCREEN_MARGIN = 90;
export const ARCADE_ENEMY_BULLET_CAP = 700;
export const ARCADE_LEVEL_CLEAR_MS = 2200;
export const ARCADE_LEVEL_CLEAR_HEAL = 20;

export const ARCADE_DIFFICULTY = {
  hpPerLevel: 0.12,
  damagePerLevel: 0.03,
  bulletSpeedPerLevel: 0.012,
  bulletSpeedCap: 1.6,
  fireRatePerLevel: 0.01,
  fireIntervalFloor: 0.55,
  scrollBase: 140,
  scrollPerLevel: 2,
} as const;

export const ARCADE_HULL_DIFFICULTY = {
  baseHull: 55,
  perDoubling: 0.07,
  cap: 1.25,
} as const;

export const ARCADE_RUN_DIFFICULTY_DAMAGE_SHARE = 0.6;
export const ARCADE_RUN_DIFFICULTY_SPEED_SHARE = 0.4;
export const ARCADE_BULLET_SPEED_HARD_CAP = 1.75;
export const ARCADE_BOSS_SWEEP_MARGIN = 20;

export interface ArcadeVec {
  x: number;
  y: number;
}
