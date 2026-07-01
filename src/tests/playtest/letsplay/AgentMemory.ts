/**
 * Letsplay engine — the agent's structured belief state (dev-only).
 *
 * The agent is a POMDP solver: {@link observe} is **egocentric** (it only reports
 * what the player can perceive *right now*), so to play like a human the agent
 * must **remember** what it has seen across steps. {@link AgentMemory} is that
 * memory — an explicit, inspectable "notebook" the agent carries for the run and
 * updates **only** from observations, never from omniscient engine state:
 *
 *  - **`priceBook`** — `planetId → (good → last-seen buy/sell + `seenAt`)`. The
 *    only prices that exist are those of a planet the agent has *landed on*; an
 *    unvisited planet is simply absent. This is what lets the agent reason
 *    "I saw METALS sell high at planet B" without re-reading the engine.
 *  - **`inventoryLots`** — held cargo tagged with the **price it was bought at**
 *    (FIFO), so the agent can compute sell-for-profit ("I paid 100, B buys at 160").
 *  - **`threatMap`** — `systemId → remembered danger` (the worst hostile presence
 *    seen there), so a route can be planned *around* a known-dangerous system.
 *  - **`knownOffers`** — upgrade/equipment offers the agent has seen and where.
 *    (No observation surfaces shop offers yet, so this is carried but unpopulated
 *    until {@link observe} exposes them — it is never invented.)
 *
 * Everything here is **pure** and **per-run**: {@link createMemory} starts a fresh
 * notebook each new game (a human starting over), and {@link updateMemory} folds a
 * single {@link Observation} into a **new** memory without mutating the input. It
 * never stores a fact the observation did not contain. Lives under `src/tests/`
 * and is dev-only.
 */
import type { ResourceType } from "@/types";
import type { Observation } from "./observe";

/** One good's last-seen prices at a planet, stamped with when it was seen. */
export interface PriceRecord {
  /** Price to buy one unit at that planet, as last observed. */
  buy: number;
  /** Price to sell one unit at that planet, as last observed. */
  sell: number;
  /** The memory step at which this price was last refreshed (re-seeing bumps it). */
  seenAt: number;
}

/**
 * A parcel of held cargo tagged with the price each unit was bought at. Lots are
 * FIFO: a sell drains the oldest lots first, so the buy-price of what remains is
 * always known for a sell-for-profit decision.
 */
export interface InventoryLot {
  good: ResourceType;
  qty: number;
  /** Per-unit price paid. `0` for cargo gained without a visible market price (loot). */
  buyPrice: number;
}

/** A known upgrade/equipment offer and where it was seen. */
export interface KnownOffer {
  /** Catalog id of the offered item (gear / hull / micromodule). */
  item: string;
  /** Asking price, as observed. */
  price: number;
  /** The location (planet / station id) the offer was seen at. */
  location: string;
}

/**
 * The agent's per-run belief state. The four head fields mirror the plan's
 * notebook; `lastCargo`/`step` are internal bookkeeping {@link updateMemory} uses
 * to detect buys/sells and to stamp `seenAt`.
 */
export interface AgentMemory {
  /** planetId → (resource → last-seen prices). Only landed planets appear. */
  priceBook: Map<string, Map<ResourceType, PriceRecord>>;
  /** Held cargo lots with the price each was bought at (FIFO for sell-profit). */
  inventoryLots: InventoryLot[];
  /** systemId → remembered danger (max hostile count ever seen in that system). */
  threatMap: Map<string, number>;
  /** Known upgrade/equipment offers, by location (populated once observed). */
  knownOffers: KnownOffer[];
  /** Internal: last observed cargo amounts, used to diff buys vs sells. */
  lastCargo: Map<ResourceType, number>;
  /** Internal: monotonic step counter; stamps `seenAt` so re-seeing advances it. */
  step: number;
  /** systemIds the run has actually been in (the current system, each step). */
  visitedSystemIds: Set<string>;
  /** The player's known outstanding loan, or absent when none is carried. */
  loanState?: { balance: number; missedPayments: number };
}

/** A fresh, empty notebook — call once per run (a human starting over). */
export function createMemory(): AgentMemory {
  return {
    priceBook: new Map(),
    inventoryLots: [],
    threatMap: new Map(),
    knownOffers: [],
    lastCargo: new Map(),
    step: 0,
    visitedSystemIds: new Set(),
    loanState: undefined,
  };
}

/** Deep-ish clone of the price book so {@link updateMemory} never mutates its input. */
function clonePriceBook(
  pb: Map<string, Map<ResourceType, PriceRecord>>,
): Map<string, Map<ResourceType, PriceRecord>> {
  const out = new Map<string, Map<ResourceType, PriceRecord>>();
  for (const [planetId, goods] of pb) out.set(planetId, new Map(goods));
  return out;
}

/**
 * Drain `qty` units of `good` from the lots, oldest first (FIFO), returning a new
 * lot list. A whole lot fully consumed is dropped; a partially-consumed lot keeps
 * its `buyPrice` on the remainder. Lots of other goods pass through untouched.
 */
function consumeLots(
  lots: InventoryLot[],
  good: ResourceType,
  qty: number,
): InventoryLot[] {
  let remaining = qty;
  const out: InventoryLot[] = [];
  for (const lot of lots) {
    if (lot.good !== good || remaining <= 0) {
      out.push(lot);
      continue;
    }
    if (lot.qty <= remaining) {
      remaining -= lot.qty; // whole lot consumed — drop it
    } else {
      out.push({ ...lot, qty: lot.qty - remaining });
      remaining = 0;
    }
  }
  return out;
}

/**
 * Fold one egocentric {@link Observation} into the belief state, returning a
 * **new** {@link AgentMemory} (the input is never mutated). It records:
 *
 *  - the **landed planet's market** into the price book (the only visible prices),
 *    bumping `seenAt` on a re-visit;
 *  - a **buy** — detected as cargo increasing while landed — as an inventory lot at
 *    that planet's observed buy price (cargo gained with no visible price, e.g.
 *    loot, is recorded at `buyPrice 0`); a **sell** drains lots FIFO;
 *  - the **worst hostile presence** seen in the current system into the threat map.
 *
 * It stores nothing the observation did not contain: no prices in flight, no
 * unvisited planet, no unseen system.
 */
export function updateMemory(mem: AgentMemory, obs: Observation): AgentMemory {
  const step = mem.step + 1;
  const priceBook = clonePriceBook(mem.priceBook);
  const threatMap = new Map(mem.threatMap);
  const knownOffers = mem.knownOffers.map((o) => ({ ...o }));
  let inventoryLots = mem.inventoryLots.map((l) => ({ ...l }));

  // No player (pre-game menus) ⇒ nothing perceivable; just advance the step.
  if (!obs.hasPlayer || !obs.player) {
    return {
      priceBook,
      inventoryLots,
      threatMap,
      knownOffers,
      lastCargo: mem.lastCargo,
      step,
      visitedSystemIds: new Set(mem.visitedSystemIds),
      loanState: mem.loanState,
    };
  }

  // 1) Price book — the landed planet's market is the only price the agent can see.
  if (obs.currentPlanet) {
    const goods =
      priceBook.get(obs.currentPlanet.id) ??
      new Map<ResourceType, PriceRecord>();
    for (const g of obs.currentPlanet.market) {
      goods.set(g.resource, { buy: g.buy, sell: g.sell, seenAt: step });
    }
    priceBook.set(obs.currentPlanet.id, goods);
  }

  // 2) Threat map — remember the worst hostile presence ever seen in this system.
  if (obs.system && obs.hostiles.length > 0) {
    const prev = threatMap.get(obs.system.id) ?? 0;
    threatMap.set(obs.system.id, Math.max(prev, obs.hostiles.length));
  }

  // 3) Inventory lots — diff held cargo against last step to detect buys/sells.
  const cargoNow = new Map<ResourceType, number>();
  for (const c of obs.player.cargo) cargoNow.set(c.type, c.amount);

  const seenGoods = new Set<ResourceType>([
    ...mem.lastCargo.keys(),
    ...cargoNow.keys(),
  ]);
  for (const good of seenGoods) {
    const before = mem.lastCargo.get(good) ?? 0;
    const after = cargoNow.get(good) ?? 0;
    if (after > before) {
      // A buy — record a lot at the landed planet's observed buy price (else loot ⇒ 0).
      const buyPrice =
        obs.currentPlanet?.market.find((m) => m.resource === good)?.buy ?? 0;
      inventoryLots.push({ good, qty: after - before, buyPrice });
    } else if (after < before) {
      // A sell / consume — drain the oldest lots of this good first.
      inventoryLots = consumeLots(inventoryLots, good, before - after);
    }
  }

  // 4) Visited systems — the current system, accumulated across the run.
  const visitedSystemIds = new Set(mem.visitedSystemIds);
  if (obs.system) visitedSystemIds.add(obs.system.id);

  // 5) Loan state — only what the observation says right now; no loan ⇒ absent.
  const loanState = obs.activeLoans
    ? {
        balance: obs.loanBalance ?? 0,
        missedPayments: obs.loanMissedPayments ?? 0,
      }
    : undefined;

  return {
    priceBook,
    inventoryLots,
    threatMap,
    knownOffers,
    lastCargo: cargoNow,
    step,
    visitedSystemIds,
    loanState,
  };
}
