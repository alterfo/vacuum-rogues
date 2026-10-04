import {
  ARCADE_DIFFICULTY,
  ARCADE_FIELD_W,
  ARCADE_TOTAL_LEVELS,
} from "./arcadeConfig";
import { ARCADE_ENEMY_DEFS } from "./arcadeEnemies";
import { nextRandom, pickWeighted, randomRange } from "./arcadeRng";
import type {
  ArcadeEnemyTypeId,
  ArcadeLevelPlan,
  ArcadePickupKind,
  ArcadeSpawn,
} from "./arcadeTypes";

const AIR_POOL: readonly ArcadeEnemyTypeId[] = [
  "scout",
  "weaver",
  "diver",
  "gunship",
  "bomber",
  "sniper",
  "strafer",
  "mineLayer",
  "armored",
  "spinner",
];

const GROUND_POOL: readonly ArcadeEnemyTypeId[] = ["turret", "tank"];

const CAPSULE_FIRST_DROP: ArcadePickupKind = "power";

function weightFor(type: ArcadeEnemyTypeId, level: number): number {
  const def = ARCADE_ENEMY_DEFS[type];
  const age = level - def.minLevel;
  const fresh = age < 4 ? 1.6 : 1;
  const base =
    def.tier === "small"
      ? 6
      : def.tier === "medium"
        ? 3
        : def.tier === "large"
          ? 1.4
          : 1;
  return base * fresh;
}

function airPool(level: number): { item: ArcadeEnemyTypeId; weight: number }[] {
  return AIR_POOL.filter((t) => ARCADE_ENEMY_DEFS[t].minLevel <= level).map(
    (item) => ({ item, weight: weightFor(item, level) }),
  );
}

function groundPool(
  level: number,
): { item: ArcadeEnemyTypeId; weight: number }[] {
  return GROUND_POOL.filter((t) => ARCADE_ENEMY_DEFS[t].minLevel <= level).map(
    (item) => ({ item, weight: weightFor(item, level) }),
  );
}

function spawn(
  atMs: number,
  type: ArcadeEnemyTypeId,
  x: number,
  extra: Partial<ArcadeSpawn> = {},
): ArcadeSpawn {
  return {
    atMs: Math.round(atMs),
    type,
    x: Math.round(Math.min(ARCADE_FIELD_W - 30, Math.max(30, x))),
    variant: 0,
    param: 0,
    dir: 1,
    drop: null,
    ...extra,
  };
}

function groupSize(type: ArcadeEnemyTypeId, level: number): number {
  const tier = ARCADE_ENEMY_DEFS[type].tier;
  if (tier === "small")
    return 3 + Math.floor(level / 12) + (nextIsEven(level) ? 1 : 0);
  if (tier === "medium") return 1 + Math.floor(level / 20);
  return 1;
}

function nextIsEven(level: number): boolean {
  return level % 2 === 0;
}

function formation(
  rng: { rngState: number },
  t: number,
  type: ArcadeEnemyTypeId,
  level: number,
  out: ArcadeSpawn[],
): void {
  const def = ARCADE_ENEMY_DEFS[type];
  const count = groupSize(type, level);
  const kind = Math.floor(nextRandom(rng) * 4);
  const dir = nextRandom(rng) < 0.5 ? -1 : 1;
  const hoverY = Math.round(randomRange(rng, 120, 260));

  if (def.move === "strafe") {
    const lane = Math.round(randomRange(rng, 160, 340));
    for (let i = 0; i < Math.min(count, 4); i++) {
      out.push(spawn(t + i * 650, type, 0, { dir, param: lane + i * 40 }));
    }
    return;
  }
  if (def.move === "hover") {
    for (let i = 0; i < count; i++) {
      const x =
        ((i + 1) / (count + 1)) * ARCADE_FIELD_W + randomRange(rng, -40, 40);
      out.push(
        spawn(t + i * 500, type, x, { param: hoverY + (i % 2) * 50, dir }),
      );
    }
    return;
  }

  const center = (count - 1) / 2;
  const baseX = randomRange(rng, 140, ARCADE_FIELD_W - 140);
  for (let i = 0; i < count; i++) {
    if (kind === 0) {
      out.push(
        spawn(t, type, ((i + 1) / (count + 1)) * ARCADE_FIELD_W, { dir }),
      );
    } else if (kind === 1) {
      const off = Math.abs(i - center);
      out.push(
        spawn(t + off * 200, type, baseX + (i - center) * 70, {
          dir,
          param: def.move === "weave" ? 70 : 0,
        }),
      );
    } else if (kind === 2) {
      out.push(
        spawn(t + i * 260, type, baseX, {
          dir,
          param: def.move === "weave" ? 110 : 0,
        }),
      );
    } else {
      out.push(
        spawn(t + i * 330, type, randomRange(rng, 60, ARCADE_FIELD_W - 60), {
          dir,
        }),
      );
    }
  }
}

export function buildArcadeLevel(level: number): ArcadeLevelPlan {
  const clamped = Math.min(ARCADE_TOTAL_LEVELS, Math.max(1, Math.floor(level)));
  const rng = { rngState: (clamped * 2654435761) ^ 0x9e3779b9 };
  const spawns: ArcadeSpawn[] = [];

  const duration = 38000 + Math.min(clamped, 40) * 400;
  const gap = Math.max(1800, 3200 - clamped * 20);

  const pool = airPool(clamped);
  let t = 1500;
  while (t < duration) {
    formation(rng, t, pickWeighted(rng, pool), clamped, spawns);
    t += gap * randomRange(rng, 0.8, 1.25);
  }

  const gpool = groundPool(clamped);
  const groundGap = Math.max(2200, 4200 - clamped * 25);
  let g = 2500;
  while (g < duration) {
    const n =
      1 +
      (nextRandom(rng) < 0.3 + clamped / 120 ? 1 : 0) +
      Math.floor(clamped / 25);
    for (let i = 0; i < n; i++) {
      spawns.push(
        spawn(
          g + i * 120,
          pickWeighted(rng, gpool),
          randomRange(rng, 70, ARCADE_FIELD_W - 70),
          {
            dir: nextRandom(rng) < 0.5 ? -1 : 1,
          },
        ),
      );
    }
    g += groundGap * randomRange(rng, 0.8, 1.3);
  }

  const capsuleAt = [3000, 17000, 31000];
  capsuleAt.forEach((at, index) => {
    if (at < duration) {
      spawns.push(
        spawn(at, "carrier", randomRange(rng, 140, ARCADE_FIELD_W - 140), {
          drop: index === 0 && clamped === 1 ? CAPSULE_FIRST_DROP : null,
          dir: nextRandom(rng) < 0.5 ? -1 : 1,
        }),
      );
    }
  });

  let bossType: ArcadeEnemyTypeId | null = null;
  if (clamped % 10 === 0) {
    bossType = "boss";
    spawns.push(
      spawn(duration + 2500, "boss", ARCADE_FIELD_W / 2, {
        variant: clamped / 10 - 1,
      }),
    );
  } else if (clamped % 5 === 0) {
    bossType = "cruiser";
    spawns.push(
      spawn(duration + 1500, "cruiser", ARCADE_FIELD_W / 2, {
        variant: clamped / 5 - 1,
      }),
    );
  } else {
    const elites = 2 + Math.floor(clamped / 10);
    for (let i = 0; i < elites; i++) {
      spawns.push(
        spawn(
          duration + 800 + i * 600,
          clamped >= 2 ? "gunship" : "weaver",
          ((i + 1) / (elites + 1)) * ARCADE_FIELD_W,
          {
            param: clamped >= 2 ? 180 : 80,
          },
        ),
      );
    }
  }

  spawns.sort((a, b) => a.atMs - b.atMs);

  return {
    level: clamped,
    theme: Math.floor((clamped - 1) / 10),
    scrollSpeed:
      ARCADE_DIFFICULTY.scrollBase + clamped * ARCADE_DIFFICULTY.scrollPerLevel,
    spawns,
    totalEnemies: spawns.length,
    bossType,
  };
}
