import {
  ARCADE_FIELD_H,
  ARCADE_FIELD_W,
} from "@/systems/blackHoleArcade/arcadeConfig";
import { advanceLevel, tick } from "@/systems/blackHoleArcade/arcadeState";
import type {
  ArcadeInput,
  ArcadeRunState,
} from "@/systems/blackHoleArcade/arcadeTypes";

const CANDIDATE_STEP = 24;
const HOME_Y = ARCADE_FIELD_H - 150;

function danger(state: ArcadeRunState, x: number, y: number): number {
  let total = 0;
  for (const b of state.enemyBullets) {
    for (const t of [0.05, 0.15, 0.3, 0.45]) {
      const bx = b.x + b.vx * t;
      const by = b.y + b.vy * t;
      const reach = b.radius + 34;
      const d2 = (bx - x) * (bx - x) + (by - y) * (by - y);
      if (d2 < reach * reach) total += 10;
      else if (d2 < (reach + 40) * (reach + 40)) total += 1;
    }
  }
  for (const e of state.enemies) {
    if (e.ground) continue;
    const reach = e.radius + 50;
    const d2 = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
    if (d2 < reach * reach) total += 8;
  }
  return total;
}

export function botInput(state: ArcadeRunState): ArcadeInput {
  const p = state.player;
  let goalX = ARCADE_FIELD_W / 2;
  let goalY = HOME_Y;

  const pickup = state.pickups
    .filter((k) => k.y > 80 && k.y < ARCADE_FIELD_H - 80)
    .sort(
      (a, b) =>
        Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
    )[0];
  if (pickup && Math.hypot(pickup.x - p.x, pickup.y - p.y) < 500) {
    goalX = pickup.x;
    goalY = Math.min(HOME_Y, pickup.y);
  } else {
    const target = state.enemies
      .filter((e) => e.y > 0 && e.y < p.y - 40)
      .sort((a, b) => b.y - a.y)[0];
    if (target) goalX = target.x;
  }

  let best = { x: p.x, y: p.y, score: Infinity };
  for (let cx = 30; cx <= ARCADE_FIELD_W - 30; cx += CANDIDATE_STEP) {
    for (const cy of [HOME_Y - 120, HOME_Y, HOME_Y + 60]) {
      const travel = Math.abs(cx - p.x) * 0.002;
      const goal = Math.abs(cx - goalX) * 0.012 + Math.abs(cy - goalY) * 0.004;
      const score = danger(state, cx, cy) * 3 + goal + travel;
      if (score < best.score) best = { x: cx, y: cy, score };
    }
  }

  return {
    targetX: best.x,
    targetY: best.y,
    moveX: 0,
    moveY: 0,
    firing: true,
    bomb:
      state.enemyBullets.length > 40 &&
      state.player.hull < state.player.maxHull * 0.5,
  };
}

export interface BotResult {
  reachedLevel: number;
  levelsCleared: number;
  phase: ArcadeRunState["phase"];
  simMs: number;
}

export function playBot(
  state: ArcadeRunState,
  options: { maxMs: number; maxLevels?: number },
): BotResult {
  let simMs = 0;
  const stopLevel = state.level + (options.maxLevels ?? 1000);
  while (simMs < options.maxMs) {
    if (state.phase === "intermission") {
      if (state.level + 1 >= stopLevel) break;
      advanceLevel(state);
    }
    if (state.phase === "lost" || state.phase === "won") break;
    tick(state, botInput(state), 16);
    simMs += 16;
  }
  return {
    reachedLevel: state.level,
    levelsCleared: state.levelsCleared,
    phase: state.phase,
    simMs,
  };
}
