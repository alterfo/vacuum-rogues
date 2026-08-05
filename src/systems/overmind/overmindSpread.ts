import { hashStr } from "@/utils/hashStr";
import type { OvermindSpreadState, OvermindStatus } from "@/types";

export type { OvermindSpreadState, OvermindStatus };

export interface OvermindSpreadConfig {
  graceDays: number;
  spreadIntervalDays: number;
  capturesPerTick: number;
  lossShare: number;
  containedShare: number;
  minSystemsForLoss: number;
}

export interface SpreadConnection {
  toSystemId: string;
}

export interface SpreadSystem {
  id: string;
  connections: readonly SpreadConnection[];
}

export interface SpreadGalaxyView {
  id: string;
  systems: readonly SpreadSystem[];
  overmindSystems: readonly string[];
  overmindCoreSystemId: string;
}

export interface OvermindAdvanceResult {
  state: OvermindSpreadState;
  captured: string[];
}

export const DEFAULT_OVERMIND_SPREAD_CONFIG: OvermindSpreadConfig = {
  graceDays: 3,
  spreadIntervalDays: 3,
  capturesPerTick: 1,
  lossShare: 0.5,
  containedShare: 0.2,
  minSystemsForLoss: 12,
};

export function initialOvermindSpreadState(): OvermindSpreadState {
  return {
    dayZero: -1,
    lastSpreadDay: -1,
    status: "dormant",
    threat: 0,
    peakThreat: 0,
  };
}

function frontierSystems(galaxy: SpreadGalaxyView): string[] {
  const overmindSet = new Set(galaxy.overmindSystems);
  if (overmindSet.size === 0) return [];
  const known = new Set(galaxy.systems.map((s) => s.id));
  const frontier = new Set<string>();
  for (const sys of galaxy.systems) {
    if (overmindSet.has(sys.id)) {
      for (const conn of sys.connections) {
        if (!overmindSet.has(conn.toSystemId) && known.has(conn.toSystemId)) {
          frontier.add(conn.toSystemId);
        }
      }
    } else {
      for (const conn of sys.connections) {
        if (overmindSet.has(conn.toSystemId)) {
          frontier.add(sys.id);
          break;
        }
      }
    }
  }
  return galaxy.systems.filter((s) => frontier.has(s.id)).map((s) => s.id);
}

const UNREACHABLE_HOPS = Number.MAX_SAFE_INTEGER;

function hopDistancesFrom(
  galaxy: SpreadGalaxyView,
  fromId: string,
): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  for (const sys of galaxy.systems) adjacency.set(sys.id, new Set());
  for (const sys of galaxy.systems) {
    for (const conn of sys.connections) {
      if (!adjacency.has(conn.toSystemId)) continue;
      adjacency.get(sys.id)!.add(conn.toSystemId);
      adjacency.get(conn.toSystemId)!.add(sys.id);
    }
  }
  const dist = new Map<string, number>([[fromId, 0]]);
  const queue = [fromId];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(cur)! + 1;
    for (const next of adjacency.get(cur) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, d);
        queue.push(next);
      }
    }
  }
  return dist;
}

export function advanceOvermind(
  state: OvermindSpreadState,
  galaxy: SpreadGalaxyView,
  day: number,
  config: OvermindSpreadConfig = DEFAULT_OVERMIND_SPREAD_CONFIG,
): OvermindAdvanceResult {
  const total = galaxy.systems.length;
  const next: OvermindSpreadState = { ...state };

  if (next.dayZero < 0) next.dayZero = day;

  if (next.status === "won" || next.status === "lost") {
    return { state: next, captured: [] };
  }

  const overmindSet = new Set(galaxy.overmindSystems);
  const hadPresence = overmindSet.size > 0 || state.peakThreat > 0;

  const engaged = state.lastSpreadDay >= 0;

  const playerParticipated = (state.playerLiberations ?? 0) > 0;

  const coreId = galaxy.overmindCoreSystemId;
  const coreBroken =
    engaged && coreId !== "" && !overmindSet.has(coreId) && hadPresence;
  const eradicated = engaged && overmindSet.size === 0 && state.peakThreat > 0;
  if (eradicated && playerParticipated) {
    next.threat = 0;
    next.status = "won";
    return { state: next, captured: [] };
  }

  const captured: string[] = [];
  const pastGrace = day >= next.dayZero + config.graceDays;
  const cadenceReady =
    next.lastSpreadDay < 0 ||
    day >= next.lastSpreadDay + config.spreadIntervalDays;

  if (pastGrace && cadenceReady && overmindSet.size > 0 && !coreBroken) {
    const lastCaptured =
      galaxy.overmindSystems[galaxy.overmindSystems.length - 1];
    const proximity =
      lastCaptured !== undefined
        ? hopDistancesFrom(galaxy, lastCaptured)
        : new Map<string, number>();
    const ranked = [...frontierSystems(galaxy)].sort((a, b) => {
      const da = proximity.get(a) ?? UNREACHABLE_HOPS;
      const db = proximity.get(b) ?? UNREACHABLE_HOPS;
      if (da !== db) return da - db;
      const ha = hashStr(`${galaxy.id}:${day}:${a}`);
      const hb = hashStr(`${galaxy.id}:${day}:${b}`);
      if (ha !== hb) return ha - hb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const take = Math.max(0, Math.floor(config.capturesPerTick));
    for (const id of ranked.slice(0, take)) {
      captured.push(id);
      overmindSet.add(id);
    }
    if (captured.length > 0) next.lastSpreadDay = day;
  }

  const share = total === 0 ? 0 : overmindSet.size / total;
  next.threat = share;
  next.peakThreat = Math.max(next.peakThreat, share);

  const bigEnough = total >= config.minSystemsForLoss;
  if (bigEnough && pastGrace && share >= config.lossShare) {
    next.status = "lost";
  } else if (!pastGrace) {
    next.status = "dormant";
  } else if (
    next.peakThreat > config.containedShare &&
    share <= config.containedShare
  ) {
    next.status = "contained";
  } else {
    next.status = "advancing";
  }

  return { state: next, captured };
}
