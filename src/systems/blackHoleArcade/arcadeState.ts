import { makeBullet } from "./arcadeBullets";
import {
  ARCADE_BOMB_BOSS_SHARE,
  ARCADE_BOMB_DPS,
  ARCADE_BOMB_DURATION_MS,
  ARCADE_ENEMY_BULLET_CAP,
  ARCADE_FIELD_H,
  ARCADE_FIELD_W,
  ARCADE_LEVEL_CLEAR_HEAL,
  ARCADE_LEVEL_CLEAR_MS,
  ARCADE_MAGNET_SPEED,
  ARCADE_MAX_FRAME_MS,
  ARCADE_MAX_STEP_MS,
  ARCADE_OFFSCREEN_MARGIN,
  ARCADE_PICKUP_FALL_SPEED,
  ARCADE_PICKUP_RADIUS,
  ARCADE_PLAYER_INVULN_MS,
  ARCADE_PLAYER_KEY_SPEED,
  ARCADE_PLAYER_MARGIN,
  ARCADE_PLAYER_PICKUP_RADIUS,
  ARCADE_PLAYER_RADIUS,
  ARCADE_PLAYER_START_BOMBS,
  ARCADE_PLAYER_START_HULL,
  ARCADE_SHIELD_REGEN_DELAY_MS,
  ARCADE_SHIELD_REGEN_PER_SEC,
  ARCADE_TOTAL_LEVELS,
} from "./arcadeConfig";
import {
  ARCADE_ENEMY_DEFS,
  createEnemy,
  difficultyScale,
  updateEnemy,
} from "./arcadeEnemies";
import { buildArcadeLevel } from "./arcadeLevels";
import {
  applyPickup,
  BOSS_REWARD_DROPS,
  rollCapsuleDrop,
  rollRandomDrop,
} from "./arcadePickups";
import { nextRandom } from "./arcadeRng";
import {
  ARCADE_IDLE_INPUT,
  type ArcadeBullet,
  type ArcadeEnemy,
  type ArcadeInput,
  type ArcadePickupKind,
  type ArcadeRunState,
} from "./arcadeTypes";
import {
  fireDrone,
  fireWeapon,
  spawnBullets,
  weaponInterval,
} from "./arcadeWeapons";

export interface ArcadeRunOptions {
  seed?: number;
  startLevel?: number;
  difficulty?: number;
}

const DRONE_INTERVAL_MS = 220;
const DRONE_OFFSET_X = 46;
const CONTACT_ENEMY_DAMAGE = 40;
const CONTACT_BOSS_DAMAGE = 15;
const CONTACT_PAD = 4;

export function createArcadeRun(
  options: ArcadeRunOptions = {},
): ArcadeRunState {
  const seed = options.seed ?? 1;
  const level = Math.min(
    ARCADE_TOTAL_LEVELS,
    Math.max(1, Math.floor(options.startLevel ?? 1)),
  );
  return {
    seed,
    difficulty: Math.max(1, options.difficulty ?? 1),
    rngState: seed | 0,
    level,
    phase: "playing",
    plan: buildArcadeLevel(level),
    nextSpawnIndex: 0,
    levelTimeMs: 0,
    scrollY: 0,
    phaseTimerMs: 0,
    player: {
      x: ARCADE_FIELD_W / 2,
      y: ARCADE_FIELD_H - 140,
      prevX: ARCADE_FIELD_W / 2,
      prevY: ARCADE_FIELD_H - 140,
      hull: ARCADE_PLAYER_START_HULL,
      maxHull: ARCADE_PLAYER_START_HULL,
      armor: 0,
      shield: 0,
      shieldMax: 0,
      shieldRegenDelayMs: 0,
      weapon: "vulcan",
      weaponLevel: 1,
      bombs: ARCADE_PLAYER_START_BOMBS,
      drones: 0,
      invulnMs: 1200,
      magnetMs: 0,
    },
    enemies: [],
    playerBullets: [],
    enemyBullets: [],
    pickups: [],
    nextId: 1,
    score: 0,
    kills: 0,
    chipCredits: 0,
    levelsCleared: level - 1,
    fireCooldownMs: 0,
    droneCooldownMs: 0,
    bombFxMs: 0,
    events: [],
  };
}

function compact<T>(items: T[], keep: (item: T) => boolean): void {
  let write = 0;
  for (let i = 0; i < items.length; i++) {
    if (keep(items[i])) items[write++] = items[i];
  }
  items.length = write;
}

function newId(state: ArcadeRunState): number {
  return state.nextId++;
}

export function damagePlayer(state: ArcadeRunState, amount: number): void {
  const player = state.player;
  if (state.phase !== "playing" && state.phase !== "levelClear") return;
  if (player.invulnMs > 0 || state.bombFxMs > 0 || amount <= 0) return;
  let remaining = amount;
  if (player.shield > 0) {
    const absorbed = Math.min(player.shield, remaining);
    player.shield -= absorbed;
    remaining -= absorbed;
  }
  player.shieldRegenDelayMs = ARCADE_SHIELD_REGEN_DELAY_MS;
  const shielded = remaining <= 0;
  if (!shielded) player.hull -= remaining * (1 - player.armor);
  player.invulnMs = shielded ? 200 : ARCADE_PLAYER_INVULN_MS;
  state.events.push({ kind: "playerHit", shielded });
  if (player.hull <= 0) {
    player.hull = 0;
    state.phase = "lost";
    state.events.push({
      kind: "explosion",
      x: player.x,
      y: player.y,
      size: 90,
    });
  }
}

function damageEnemy(enemy: ArcadeEnemy, amount: number): void {
  enemy.hp -= amount;
  enemy.hitFlashMs = 70;
}

function movePlayer(
  state: ArcadeRunState,
  input: ArcadeInput,
  dtMs: number,
): void {
  const player = state.player;
  const dtSec = dtMs / 1000;
  player.prevX = player.x;
  player.prevY = player.y;
  if (input.targetX !== null && input.targetY !== null) {
    player.x = input.targetX;
    player.y = input.targetY;
  } else if (input.moveX !== 0 || input.moveY !== 0) {
    const len = Math.hypot(input.moveX, input.moveY) || 1;
    player.x += (input.moveX / len) * ARCADE_PLAYER_KEY_SPEED * dtSec;
    player.y += (input.moveY / len) * ARCADE_PLAYER_KEY_SPEED * dtSec;
  }
  player.x = Math.min(
    ARCADE_FIELD_W - ARCADE_PLAYER_MARGIN,
    Math.max(ARCADE_PLAYER_MARGIN, player.x),
  );
  player.y = Math.min(
    ARCADE_FIELD_H - ARCADE_PLAYER_MARGIN,
    Math.max(ARCADE_PLAYER_MARGIN, player.y),
  );
}

function firePlayer(
  state: ArcadeRunState,
  input: ArcadeInput,
  dtMs: number,
): void {
  const player = state.player;
  state.fireCooldownMs = Math.max(0, state.fireCooldownMs - dtMs);
  state.droneCooldownMs = Math.max(0, state.droneCooldownMs - dtMs);
  if (!input.firing || state.phase !== "playing") return;

  if (state.fireCooldownMs <= 0) {
    const result = fireWeapon(
      player.weapon,
      player.weaponLevel,
      player.x,
      player.y,
      state.enemies,
    );
    state.playerBullets.push(
      ...spawnBullets(result.bullets, () => newId(state)),
    );
    for (const target of result.arcTargets) {
      const enemy = state.enemies.find((e) => e.id === target.enemyId);
      if (enemy) {
        damageEnemy(enemy, target.damage);
        state.events.push({ kind: "hit", x: enemy.x, y: enemy.y });
      }
    }
    if (result.arcPoints.length > 0) {
      state.events.push({ kind: "arc", points: result.arcPoints });
    }
    if (result.bullets.length > 0 || result.arcTargets.length > 0) {
      state.events.push({ kind: "fire", weapon: player.weapon });
    }
    state.fireCooldownMs = weaponInterval(player.weapon, player.weaponLevel);
  }

  if (player.drones > 0 && state.droneCooldownMs <= 0) {
    for (let i = 0; i < player.drones; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      state.playerBullets.push(
        makeBullet(
          newId(state),
          fireDrone(player.x + side * DRONE_OFFSET_X, player.y + 14),
        ),
      );
    }
    state.droneCooldownMs = DRONE_INTERVAL_MS;
  }
}

function nearestEnemy(
  enemies: readonly ArcadeEnemy[],
  x: number,
  y: number,
): ArcadeEnemy | null {
  let best: ArcadeEnemy | null = null;
  let bestDist = Infinity;
  for (const enemy of enemies) {
    if (enemy.y < -20 || enemy.hp <= 0) continue;
    const d = (enemy.x - x) * (enemy.x - x) + (enemy.y - y) * (enemy.y - y);
    if (d < bestDist) {
      best = enemy;
      bestDist = d;
    }
  }
  return best;
}

function steerHoming(
  state: ArcadeRunState,
  bullet: ArcadeBullet,
  dtSec: number,
): void {
  const target = nearestEnemy(state.enemies, bullet.x, bullet.y);
  if (!target) return;
  const current = Math.atan2(bullet.vy, bullet.vx);
  const desired = Math.atan2(target.y - bullet.y, target.x - bullet.x);
  let diff = desired - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const maxTurn = bullet.homingTurn * dtSec;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  const angle = current + turn;
  bullet.vx = Math.cos(angle) * bullet.speed;
  bullet.vy = Math.sin(angle) * bullet.speed;
}

function advancePlayerBullets(state: ArcadeRunState, dtMs: number): void {
  const dtSec = dtMs / 1000;
  for (const bullet of state.playerBullets) {
    bullet.ageMs += dtMs;
    if (bullet.homingTurn > 0) steerHoming(state, bullet, dtSec);
    if (bullet.waveAmp > 0) {
      bullet.y += bullet.vy * dtSec;
      bullet.x =
        bullet.waveBaseX +
        Math.sin((bullet.ageMs / 1000) * bullet.waveFreq + bullet.wavePhase) *
          bullet.waveAmp;
    } else {
      bullet.x += bullet.vx * dtSec;
      bullet.y += bullet.vy * dtSec;
    }
  }
  compact(
    state.playerBullets,
    (b) =>
      b.y > -60 &&
      b.y < ARCADE_FIELD_H + 60 &&
      b.x > -60 &&
      b.x < ARCADE_FIELD_W + 60 &&
      (b.ttlMs === 0 || b.ageMs < b.ttlMs),
  );
}

function advanceEnemyBullets(state: ArcadeRunState, dtMs: number): void {
  const dtSec = dtMs / 1000;
  for (const bullet of state.enemyBullets) {
    bullet.ageMs += dtMs;
    bullet.x += bullet.vx * dtSec;
    bullet.y += bullet.vy * dtSec;
  }
  const margin = ARCADE_OFFSCREEN_MARGIN;
  compact(
    state.enemyBullets,
    (b) =>
      b.x > -margin &&
      b.x < ARCADE_FIELD_W + margin &&
      b.y > -margin * 2 &&
      b.y < ARCADE_FIELD_H + margin &&
      (b.ttlMs === 0 || b.ageMs < b.ttlMs),
  );
}

function blastAt(
  state: ArcadeRunState,
  x: number,
  y: number,
  radius: number,
  damage: number,
  skipId: number,
): void {
  state.events.push({ kind: "blast", x, y, radius });
  for (const enemy of state.enemies) {
    if (enemy.id === skipId) continue;
    if (Math.hypot(enemy.x - x, enemy.y - y) <= radius + enemy.radius) {
      damageEnemy(enemy, damage * 0.6);
    }
  }
}

function resolvePlayerBullets(state: ArcadeRunState): void {
  const consumed = new Set<number>();
  for (const bullet of state.playerBullets) {
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || enemy.y < -enemy.radius) continue;
      if (bullet.hitIds.includes(enemy.id)) continue;
      const reach = bullet.radius + enemy.radius;
      const dx = bullet.x - enemy.x;
      const dy = bullet.y - enemy.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      damageEnemy(enemy, bullet.damage);
      state.events.push({ kind: "hit", x: bullet.x, y: bullet.y });
      if (bullet.blast > 0) {
        blastAt(
          state,
          bullet.x,
          bullet.y,
          bullet.blast,
          bullet.damage,
          enemy.id,
        );
      }
      if (bullet.pierce > 0) {
        bullet.pierce -= 1;
        bullet.hitIds.push(enemy.id);
        continue;
      }
      consumed.add(bullet.id);
      break;
    }
  }
  if (consumed.size > 0) {
    compact(state.playerBullets, (b) => !consumed.has(b.id));
  }
}

function distToPlayerPathSq(
  player: ArcadeRunState["player"],
  x: number,
  y: number,
): number {
  const ax = player.prevX;
  const ay = player.prevY;
  const abx = player.x - ax;
  const aby = player.y - ay;
  const lenSq = abx * abx + aby * aby;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / lenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return (x - cx) * (x - cx) + (y - cy) * (y - cy);
}

function resolveEnemyThreats(state: ArcadeRunState): void {
  const player = state.player;
  const scale = difficultyScale(state.level, state.difficulty);
  const consumed = new Set<number>();
  for (const bullet of state.enemyBullets) {
    const reach = bullet.radius + ARCADE_PLAYER_RADIUS;
    if (distToPlayerPathSq(player, bullet.x, bullet.y) <= reach * reach) {
      consumed.add(bullet.id);
      damagePlayer(state, bullet.damage);
    }
  }
  if (consumed.size > 0) {
    compact(state.enemyBullets, (b) => !consumed.has(b.id));
  }
  for (const enemy of state.enemies) {
    if (enemy.ground || enemy.hp <= 0) continue;
    const def = ARCADE_ENEMY_DEFS[enemy.type];
    const reach = enemy.radius + ARCADE_PLAYER_RADIUS + CONTACT_PAD;
    if (distToPlayerPathSq(player, enemy.x, enemy.y) > reach * reach) continue;
    if (player.invulnMs > 0 || state.bombFxMs > 0) continue;
    damagePlayer(state, def.contactDamage * scale.damage);
    damageEnemy(
      enemy,
      enemy.isBoss ? CONTACT_BOSS_DAMAGE : CONTACT_ENEMY_DAMAGE,
    );
  }
}

function dropPickup(
  state: ArcadeRunState,
  kind: ArcadePickupKind,
  x: number,
  y: number,
): void {
  state.pickups.push({
    id: newId(state),
    kind,
    x,
    y,
    radius: ARCADE_PICKUP_RADIUS,
    ageMs: 0,
  });
}

function reapEnemies(state: ArcadeRunState): void {
  let anyBossDown = false;
  compact(state.enemies, (enemy) => {
    if (enemy.hp > 0) return true;
    const def = ARCADE_ENEMY_DEFS[enemy.type];
    state.score += def.score * state.level;
    state.kills += 1;
    state.events.push({
      kind: "explosion",
      x: enemy.x,
      y: enemy.y,
      size: enemy.radius * (enemy.isBoss ? 3 : 2.2),
    });
    if (enemy.isBoss) {
      anyBossDown = true;
      BOSS_REWARD_DROPS.forEach((kind, i) => {
        dropPickup(state, kind, enemy.x + (i - 2) * 46, enemy.y);
      });
      dropPickup(state, rollCapsuleDrop(state), enemy.x, enemy.y - 40);
      return false;
    }
    if (enemy.drop) {
      dropPickup(state, enemy.drop, enemy.x, enemy.y);
    } else if (enemy.type === "carrier") {
      dropPickup(state, rollCapsuleDrop(state), enemy.x, enemy.y);
    } else if (nextRandom(state) < def.dropChance) {
      dropPickup(state, rollRandomDrop(state), enemy.x, enemy.y);
    }
    return false;
  });
  if (anyBossDown) {
    state.enemyBullets.length = 0;
    state.events.push({ kind: "bossDown" });
  }
}

function updatePickups(state: ArcadeRunState, dtMs: number): void {
  const player = state.player;
  const dtSec = dtMs / 1000;
  const magnet = player.magnetMs > 0;
  for (const pickup of state.pickups) {
    pickup.ageMs += dtMs;
    if (magnet) {
      const dx = player.x - pickup.x;
      const dy = player.y - pickup.y;
      const dist = Math.hypot(dx, dy) || 1;
      pickup.x += (dx / dist) * ARCADE_MAGNET_SPEED * dtSec;
      pickup.y += (dy / dist) * ARCADE_MAGNET_SPEED * dtSec;
    } else {
      pickup.y += ARCADE_PICKUP_FALL_SPEED * dtSec;
      pickup.x += Math.sin(pickup.ageMs / 400) * 18 * dtSec;
    }
  }
  compact(state.pickups, (pickup) => {
    const reach = pickup.radius + ARCADE_PLAYER_PICKUP_RADIUS;
    const dx = pickup.x - player.x;
    const dy = pickup.y - player.y;
    if (dx * dx + dy * dy <= reach * reach) {
      const outcome = applyPickup(player, pickup.kind, state.level);
      state.chipCredits += outcome.chipCredits;
      state.score += outcome.score;
      state.events.push({
        kind: "pickup",
        x: pickup.x,
        y: pickup.y,
        pickup: pickup.kind,
      });
      return false;
    }
    return pickup.y < ARCADE_FIELD_H + 60 && pickup.y > -200;
  });
}

function applyBomb(
  state: ArcadeRunState,
  wantBomb: boolean,
  dtMs: number,
): void {
  const player = state.player;
  if (
    wantBomb &&
    state.phase === "playing" &&
    state.bombFxMs <= 0 &&
    player.bombs > 0
  ) {
    player.bombs -= 1;
    state.bombFxMs = ARCADE_BOMB_DURATION_MS;
    state.events.push({ kind: "bombStart" });
  }
  if (state.bombFxMs <= 0) return;
  state.bombFxMs = Math.max(0, state.bombFxMs - dtMs);
  state.enemyBullets.length = 0;
  const damage = (ARCADE_BOMB_DPS * dtMs) / 1000;
  for (const enemy of state.enemies) {
    if (enemy.y < -enemy.radius) continue;
    damageEnemy(enemy, enemy.isBoss ? damage * ARCADE_BOMB_BOSS_SHARE : damage);
  }
}

function spawnDue(state: ArcadeRunState): void {
  const spawns = state.plan.spawns;
  while (
    state.nextSpawnIndex < spawns.length &&
    spawns[state.nextSpawnIndex].atMs <= state.levelTimeMs
  ) {
    const spawn = spawns[state.nextSpawnIndex++];
    state.enemies.push(
      createEnemy(newId(state), spawn, state.level, -40, state.difficulty),
    );
  }
}

function updateEnemies(state: ArcadeRunState, dtMs: number): void {
  const ctx = {
    playerX: state.player.x,
    playerY: state.player.y,
    scrollSpeed: state.plan.scrollSpeed,
    level: state.level,
    difficulty: state.difficulty,
    rng: state,
    nextId: () => newId(state),
  };
  const extraSpawns: ArcadeRunState["plan"]["spawns"] = [];
  for (const enemy of state.enemies) {
    const result = updateEnemy(enemy, dtMs, ctx);
    if (state.enemyBullets.length < ARCADE_ENEMY_BULLET_CAP) {
      state.enemyBullets.push(
        ...spawnBullets(result.bullets, () => newId(state)),
      );
    }
    extraSpawns.push(...result.spawns);
  }
  for (const spawn of extraSpawns) {
    state.enemies.push(
      createEnemy(newId(state), spawn, state.level, -40, state.difficulty),
    );
  }
  const margin = ARCADE_OFFSCREEN_MARGIN;
  compact(
    state.enemies,
    (e) =>
      e.hp <= 0 ||
      (e.y < ARCADE_FIELD_H + margin &&
        e.x > -margin * 2 &&
        e.x < ARCADE_FIELD_W + margin * 2),
  );
}

function regenerateShield(state: ArcadeRunState, dtMs: number): void {
  const player = state.player;
  player.invulnMs = Math.max(0, player.invulnMs - dtMs);
  player.magnetMs = Math.max(0, player.magnetMs - dtMs);
  if (player.shieldMax <= 0) return;
  player.shieldRegenDelayMs = Math.max(0, player.shieldRegenDelayMs - dtMs);
  if (player.shieldRegenDelayMs <= 0 && player.shield < player.shieldMax) {
    player.shield = Math.min(
      player.shieldMax,
      player.shield + (ARCADE_SHIELD_REGEN_PER_SEC * dtMs) / 1000,
    );
  }
}

function checkLevelClear(state: ArcadeRunState): void {
  if (state.phase !== "playing") return;
  if (state.nextSpawnIndex < state.plan.spawns.length) return;
  if (state.enemies.length > 0) return;
  state.phase = "levelClear";
  state.phaseTimerMs = ARCADE_LEVEL_CLEAR_MS;
  state.levelsCleared = Math.max(state.levelsCleared, state.level);
  state.score += state.level * 500;
  state.enemyBullets.length = 0;
  state.events.push({ kind: "levelClear", level: state.level });
}

function step(
  state: ArcadeRunState,
  input: ArcadeInput,
  dtMs: number,
  wantBomb: boolean,
): void {
  if (
    state.phase === "lost" ||
    state.phase === "won" ||
    state.phase === "intermission"
  ) {
    return;
  }

  state.scrollY += state.plan.scrollSpeed * (dtMs / 1000);
  movePlayer(state, input, dtMs);

  if (state.phase === "levelClear") {
    state.phaseTimerMs -= dtMs;
    advancePlayerBullets(state, dtMs);
    updatePickups(state, dtMs);
    regenerateShield(state, dtMs);
    if (state.phaseTimerMs <= 0) {
      state.phase = state.level >= ARCADE_TOTAL_LEVELS ? "won" : "intermission";
    }
    return;
  }

  state.levelTimeMs += dtMs;
  spawnDue(state);
  firePlayer(state, input, dtMs);
  applyBomb(state, wantBomb, dtMs);
  updateEnemies(state, dtMs);
  advancePlayerBullets(state, dtMs);
  advanceEnemyBullets(state, dtMs);
  resolvePlayerBullets(state);
  resolveEnemyThreats(state);
  reapEnemies(state);
  updatePickups(state, dtMs);
  regenerateShield(state, dtMs);
  checkLevelClear(state);
}

export function tick(
  state: ArcadeRunState,
  input: ArcadeInput,
  dtMs: number,
): ArcadeRunState {
  state.events.length = 0;
  const total = Math.min(ARCADE_MAX_FRAME_MS, Math.max(0, dtMs));
  const steps = Math.max(1, Math.ceil(total / ARCADE_MAX_STEP_MS));
  const stepMs = total / steps;
  for (let i = 0; i < steps; i++) {
    step(state, input, stepMs, i === 0 && input.bomb);
    if (state.phase === "lost" || state.phase === "won") break;
  }
  return state;
}

export function advanceLevel(state: ArcadeRunState): boolean {
  if (state.phase !== "intermission") return false;
  state.level += 1;
  state.plan = buildArcadeLevel(state.level);
  state.nextSpawnIndex = 0;
  state.levelTimeMs = 0;
  state.enemies.length = 0;
  state.enemyBullets.length = 0;
  state.playerBullets.length = 0;
  state.pickups.length = 0;
  state.bombFxMs = 0;
  const player = state.player;
  player.hull = Math.min(player.maxHull, player.hull + ARCADE_LEVEL_CLEAR_HEAL);
  player.invulnMs = 1500;
  state.phase = "playing";
  return true;
}

export { ARCADE_IDLE_INPUT };
