export type ArcadeWeaponId =
  | "vulcan"
  | "laser"
  | "homing"
  | "wave"
  | "plasma"
  | "arc";

export const ARCADE_WEAPON_IDS: readonly ArcadeWeaponId[] = [
  "vulcan",
  "laser",
  "homing",
  "wave",
  "plasma",
  "arc",
];

export type ArcadeBulletKind =
  | "pulse"
  | "laser"
  | "missile"
  | "wave"
  | "plasma"
  | "drone"
  | "enemyOrb"
  | "enemyNeedle"
  | "enemyBig"
  | "enemyMine";

export interface ArcadeBullet {
  id: number;
  owner: "player" | "enemy";
  kind: ArcadeBulletKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  pierce: number;
  hitIds: number[];
  ttlMs: number;
  ageMs: number;
  homingTurn: number;
  waveBaseX: number;
  waveAmp: number;
  waveFreq: number;
  wavePhase: number;
  blast: number;
  speed: number;
}

export type ArcadePickupKind =
  | "weapon_vulcan"
  | "weapon_laser"
  | "weapon_homing"
  | "weapon_wave"
  | "weapon_plasma"
  | "weapon_arc"
  | "power"
  | "repair_small"
  | "repair_full"
  | "plating"
  | "armor_coat"
  | "shield"
  | "bomb"
  | "wingman"
  | "magnet"
  | "chip";

export const ARCADE_PICKUP_KINDS: readonly ArcadePickupKind[] = [
  "weapon_vulcan",
  "weapon_laser",
  "weapon_homing",
  "weapon_wave",
  "weapon_plasma",
  "weapon_arc",
  "power",
  "repair_small",
  "repair_full",
  "plating",
  "armor_coat",
  "shield",
  "bomb",
  "wingman",
  "magnet",
  "chip",
];

export interface ArcadePickup {
  id: number;
  kind: ArcadePickupKind;
  x: number;
  y: number;
  radius: number;
  ageMs: number;
}

export type ArcadeEnemyTypeId =
  | "scout"
  | "weaver"
  | "diver"
  | "gunship"
  | "bomber"
  | "sniper"
  | "carrier"
  | "strafer"
  | "turret"
  | "tank"
  | "mineLayer"
  | "armored"
  | "spinner"
  | "cruiser"
  | "boss";

export interface ArcadeEnemy {
  id: number;
  type: ArcadeEnemyTypeId;
  variant: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hp: number;
  maxHp: number;
  ageMs: number;
  originX: number;
  param: number;
  dir: number;
  fireTimers: number[];
  phase: number;
  hitFlashMs: number;
  drop: ArcadePickupKind | null;
  ground: boolean;
  isBoss: boolean;
  spawnTimerMs: number;
  holdMs: number;
}

export interface ArcadeSpawn {
  atMs: number;
  type: ArcadeEnemyTypeId;
  x: number;
  y?: number;
  variant: number;
  param: number;
  dir: number;
  drop: ArcadePickupKind | null;
}

export interface ArcadeLevelPlan {
  level: number;
  theme: number;
  scrollSpeed: number;
  spawns: ArcadeSpawn[];
  totalEnemies: number;
  bossType: ArcadeEnemyTypeId | null;
}

export type ArcadePhase =
  | "playing"
  | "levelClear"
  | "intermission"
  | "lost"
  | "won";

export interface ArcadePlayer {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  hull: number;
  maxHull: number;
  armor: number;
  shield: number;
  shieldMax: number;
  shieldRegenDelayMs: number;
  weapon: ArcadeWeaponId;
  weaponLevel: number;
  bombs: number;
  drones: number;
  invulnMs: number;
  magnetMs: number;
}

export type ArcadeEvent =
  | { kind: "explosion"; x: number; y: number; size: number }
  | { kind: "hit"; x: number; y: number }
  | { kind: "pickup"; x: number; y: number; pickup: ArcadePickupKind }
  | { kind: "bombStart" }
  | { kind: "arc"; points: { x: number; y: number }[] }
  | { kind: "playerHit"; shielded: boolean }
  | { kind: "levelClear"; level: number }
  | { kind: "bossDown" }
  | { kind: "blast"; x: number; y: number; radius: number }
  | { kind: "fire"; weapon: ArcadeWeaponId };

export interface ArcadeRunState {
  seed: number;
  difficulty: number;
  rngState: number;
  level: number;
  phase: ArcadePhase;
  plan: ArcadeLevelPlan;
  nextSpawnIndex: number;
  levelTimeMs: number;
  scrollY: number;
  phaseTimerMs: number;
  player: ArcadePlayer;
  enemies: ArcadeEnemy[];
  playerBullets: ArcadeBullet[];
  enemyBullets: ArcadeBullet[];
  pickups: ArcadePickup[];
  nextId: number;
  score: number;
  kills: number;
  chipCredits: number;
  levelsCleared: number;
  fireCooldownMs: number;
  droneCooldownMs: number;
  bombFxMs: number;
  events: ArcadeEvent[];
}

export interface ArcadeInput {
  targetX: number | null;
  targetY: number | null;
  moveX: number;
  moveY: number;
  firing: boolean;
  bomb: boolean;
}

export const ARCADE_IDLE_INPUT: ArcadeInput = {
  targetX: null,
  targetY: null,
  moveX: 0,
  moveY: 0,
  firing: false,
  bomb: false,
};
