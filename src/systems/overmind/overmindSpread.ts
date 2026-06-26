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

/**
 * Advance the Overmind arc one EOD tick.
 *
 * - Initialises the arc clock on first call.
 * - Sticky once `won`/`lost`.
 * - **Win** when the core is broken (removed from Overmind control) or the
 *   Overmind is eradicated entirely (a started arc reduced to zero systems).
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

  // --- Win: core broken, or the Overmind eradicated after a real start. ---
  const coreId = galaxy.overmindCoreSystemId;
  const coreBroken = coreId !== "" && !overmindSet.has(coreId) && hadPresence;
  const eradicated = overmindSet.size === 0 && state.peakThreat > 0;
  if (coreBroken || eradicated) {
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
    const ranked = [...frontierSystems(galaxy)].sort((a, b) => {
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
