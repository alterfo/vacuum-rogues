import { hashStr } from "@/utils/hashStr";
import type { OvermindSpreadState, OvermindStatus } from "@/types";

/**
 * Overmind endgame-arc spread state machine (pure).
 *
 * This is the *escalating* counterpart to the equilibrium `stepOwnershipTick`
 * (`src/systems/galaxy/OvermindBalance.ts`): where that pins a stable hostile
 * share, this drives a deliberate front that **grows over time** unless the
 * player pushes it back — the narrative arc. It captures faction systems on a
 * fixed cadence and classifies the arc into a small status machine
 * (`dormant → advancing ⇄ contained → won|lost`).
 *
 * Pure: no GameEngine/PixiJS/DOM coupling, deterministic by (galaxy seed, day).
 * The caller (the EOD batch) applies the returned `captured` ids to the live
 * galaxy via `galaxy.addOvermindSystem` and persists `state`.
 */

// The persisted arc state + status enum are defined in the Types layer (`@/types`)
// so the domain (`Galaxy`) and validation (`schemas.ts`) can reference them
// without an upward import from `systems/`. Re-exported here under their canonical
// names so the spread machine stays their conceptual home.
export type { OvermindSpreadState, OvermindStatus };

export interface OvermindSpreadConfig {
  /** No spread before `dayZero + graceDays` (the threat ramps in, not instantly). */
  graceDays: number;
  /** Capture cadence: a spread tick only fires every N days. */
  spreadIntervalDays: number;
  /** Frontier systems captured per spread tick. */
  capturesPerTick: number;
  /** Overmind share at/above which (past grace, big enough) the galaxy is lost. */
  lossShare: number;
  /** Once the share peaked above this and is now at/below it, the arc is contained. */
  containedShare: number;
  /** Loss is suppressed on tiny/legacy maps below this system count. */
  minSystemsForLoss: number;
}

/** Minimal connection shape (matches `WarpPath`). */
export interface SpreadConnection {
  toSystemId: string;
}

/** Minimal system shape (the real `StarSystem` satisfies this structurally). */
export interface SpreadSystem {
  id: string;
  connections: readonly SpreadConnection[];
}

/** Minimal galaxy view the spread machine reads (the real `Galaxy` satisfies it). */
export interface SpreadGalaxyView {
  /** Galaxy seed/id — folded into the deterministic capture ranking. */
  id: string;
  systems: readonly SpreadSystem[];
  /** Systems currently Overmind-controlled (the front's source of truth). */
  overmindSystems: readonly string[];
  /** The core/boss system; breaking it (removing from overmind control) wins. */
  overmindCoreSystemId: string;
}

export interface OvermindAdvanceResult {
  /** The next arc state (persist this). */
  state: OvermindSpreadState;
  /** Frontier system ids the Overmind newly captured this tick (apply to the galaxy). */
  captured: string[];
}

/**
 * Default arc tuning. Moved to `balance.ts` in the balance pass; kept here so
 * the pure machine has a sensible standalone default for tests/callers.
 */
export const DEFAULT_OVERMIND_SPREAD_CONFIG: OvermindSpreadConfig = {
  graceDays: 3,
  spreadIntervalDays: 3,
  capturesPerTick: 1,
  lossShare: 0.5,
  containedShare: 0.2,
  minSystemsForLoss: 12,
};

/** A fresh, never-advanced arc state (dormant, no clock). */
export function initialOvermindSpreadState(): OvermindSpreadState {
  return {
    dayZero: -1,
    lastSpreadDay: -1,
    status: "dormant",
    threat: 0,
    peakThreat: 0,
  };
}

/**
 * Non-Overmind systems that border at least one Overmind system — the set the
 * front can grow into. The warp graph is treated as **undirected**: a system is
 * frontier if it links *to* an Overmind system **or** an Overmind system links
 * *to it*. This matters because galaxy warp links are **not** all stored
 * bidirectionally (`ensureConnectivity` bridges components with one-way edges —
 * empirically ~25% of links are asymmetric). A purely directed
 * candidate→Overmind scan misses every system the Overmind cluster reaches by a
 * one-way *outgoing* edge, which silently boxes the front in and stalls the arc
 * for dozens of days (the captured cluster looks "surrounded" when it isn't).
 */
function frontierSystems(galaxy: SpreadGalaxyView): string[] {
  const overmindSet = new Set(galaxy.overmindSystems);
  if (overmindSet.size === 0) return [];
  const known = new Set(galaxy.systems.map((s) => s.id));
  const frontier = new Set<string>();
  for (const sys of galaxy.systems) {
    if (overmindSet.has(sys.id)) {
      // Outgoing edges: Overmind → faction (one-way bridges live here).
      for (const conn of sys.connections) {
        if (!overmindSet.has(conn.toSystemId) && known.has(conn.toSystemId)) {
          frontier.add(conn.toSystemId);
        }
      }
    } else {
      // Incoming edges: faction → Overmind.
      for (const conn of sys.connections) {
        if (overmindSet.has(conn.toSystemId)) {
          frontier.add(sys.id);
          break;
        }
      }
    }
  }
  // Stable, systems-order listing (the caller re-ranks deterministically anyway).
  return galaxy.systems.filter((s) => frontier.has(s.id)).map((s) => s.id);
}

/** Sorts-after-everything sentinel for frontier candidates the BFS can't reach. */
const UNREACHABLE_HOPS = Number.MAX_SAFE_INTEGER;

/**
 * Undirected warp-hop distances from `fromId` to every reachable system (BFS).
 * Undirected for the same reason as `frontierSystems`: ~25% of warp links are
 * stored one-way, and a directed walk would misjudge reachable neighbors.
 * Deterministic: distances are shortest-path lengths, independent of visit order.
 */
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

/**
 * Advance the Overmind arc one EOD tick.
 *
 * - Initialises the arc clock on first call.
 * - Sticky once `won`/`lost`.
 * - **Win** — only after the arc has GENUINELY ENGAGED (`lastSpreadDay >= 0`,
 *   i.e. it actually spread at least once) AND the player PARTICIPATED
 *   (`playerLiberations > 0` — a real combat clear or a completed DEFENSE
 *   quest) — when the core is broken (removed from Overmind control) or the
 *   Overmind is eradicated entirely (an *engaged* arc reduced to zero
 *   systems). Clearing the never-engaged dormant starting front is **not** a
 *   win, and neither is an NPC-only equilibrium clearing the whole front
 *   while the player never fought (F10 — see `Galaxy.tryLiberate`'s `source`
 *   param).
 * - **Spread** on cadence past the grace period: captures `capturesPerTick`
 *   frontier systems, ranked deterministically by `hash(seed:day:id)`.
 * - **Status** is then re-derived from the post-capture share: `lost` past the
 *   loss line, `contained` once pushed back below the contained line, else
 *   `advancing` (or `dormant` during grace).
 *
 * The galaxy is read-only here; the caller applies `captured` to it.
 */
export function advanceOvermind(
  state: OvermindSpreadState,
  galaxy: SpreadGalaxyView,
  day: number,
  config: OvermindSpreadConfig = DEFAULT_OVERMIND_SPREAD_CONFIG,
): OvermindAdvanceResult {
  const total = galaxy.systems.length;
  const next: OvermindSpreadState = { ...state };

  // The arc clock starts on the first advance ever run.
  if (next.dayZero < 0) next.dayZero = day;

  // Terminal states never re-open.
  if (next.status === "won" || next.status === "lost") {
    return { state: next, captured: [] };
  }

  const overmindSet = new Set(galaxy.overmindSystems);
  const hadPresence = overmindSet.size > 0 || state.peakThreat > 0;

  // The arc may declare victory only once it has GENUINELY ENGAGED — i.e. it has
  // actually spread at least once past the grace period (`lastSpreadDay >= 0`).
  // `peakThreat` is a false proxy for "the threat was real": it captures the
  // *initial* Overmind share (e.g. 2/30 ≈ 0.067) on the very first EOD even while
  // the status is still `dormant` during the grace window, so before this gate any
  // clearance of the two isolated starting systems — an early player skirmish, an
  // autonomous NPC convoy liberation, or a quest liberation — tripped
  // `coreBroken`/`eradicated` and fired a spurious "ПОБЕДА!" the player never
  // earned (the in-flight core-kill win goes through `showGameOutcomeScreen`
  // directly, so it is unaffected). A never-engaged dormant front being cleared is
  // not winning the endgame arc.
  const engaged = state.lastSpreadDay >= 0;

  // The arc may also declare victory only when the PLAYER actually shrank the
  // front at least once (`playerLiberations > 0` — a real combat clear or a
  // completed DEFENSE quest, tracked by `Galaxy.tryLiberate(id, "player")`).
  // Without this an NPC-only equilibrium (Ranger auto-liberation, the
  // garrison-cleared-and-held countdown) can clear every Overmind system on
  // its own and fire a victory the player never earned (F10, live-session
  // finding: a rank-0, never-battle-ready player got "ПОБЕДА!" at day ~140).
  const playerParticipated = (state.playerLiberations ?? 0) > 0;

  // --- Win: core broken, or the Overmind eradicated, after a real engagement
  //     AND real player participation. ---
  const coreId = galaxy.overmindCoreSystemId;
  const coreBroken =
    engaged && coreId !== "" && !overmindSet.has(coreId) && hadPresence;
  const eradicated = engaged && overmindSet.size === 0 && state.peakThreat > 0;
  if ((coreBroken || eradicated) && playerParticipated) {
    next.threat = total === 0 ? 0 : overmindSet.size / total;
    next.peakThreat = Math.max(next.peakThreat, next.threat);
    next.status = "won";
    return { state: next, captured: [] };
  }

  // --- Spread on cadence, only past the grace period. ---
  const captured: string[] = [];
  const pastGrace = day >= next.dayZero + config.graceDays;
  const cadenceReady =
    next.lastSpreadDay < 0 ||
    day >= next.lastSpreadDay + config.spreadIntervalDays;

  if (pastGrace && cadenceReady && overmindSet.size > 0) {
    // Coherent-front bias: rank candidates by warp-hop proximity to the most
    // recently captured system first (`overmindSystems` is append-ordered by
    // `Galaxy.addOvermindSystem`, so the last entry is the freshest capture),
    // hash-tiebreak within a distance band. Without this the pure hash re-rolls
    // the whole border every tick and a single contiguous blob's growth can
    // jump between its far edges — the "appears from all sides" playtest feel.
    // Still fully deterministic by (galaxy.id, day, systemId).
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

  // --- Re-derive threat + status from the post-capture share. ---
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
