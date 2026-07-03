/**
 * Letsplay engine — shared live-engine query helpers (dev-only).
 *
 * Small, pure projections off the live {@link GameEngine} that both action
 * appliers need: the headless {@link PlayerAgent} (driving the harness) and the
 * live {@link createLiveSceneController} (driving the rendered scene). Keeping
 * them here is the single source of truth, so a fix to how the agent resolves its
 * current system / landed planet / board quests reaches *both* loops at once.
 *
 * Dev-only: lives under `src/tests/`, imported by no production module (enforced
 * by `letsplayDevOnly.test.ts`).
 */
import type { GameEngine } from "@/systems/GameEngine";
import type { StarSystem } from "@/domain/StarSystem";
import type { Planet } from "@/domain/Planet";
import type { ResourceType } from "@/types";
import { TradeSystem } from "@/systems/TradeSystem";
import {
  cargoCapacityOf,
  applyLoadoutHullToShip,
} from "@/systems/equipment/GearBridge";
import { hullStatus } from "@/systems/equipment/hullStatus";
import {
  adjustPlayerCredits,
  GL_COUNTERPARTY,
} from "@/systems/banking/economy";

/** Resolve the player's current star system from the live engine, if any. */
export function currentSystem(engine: GameEngine): StarSystem | null {
  const player = engine.player;
  const galaxy = engine.galaxy;
  if (!player || !galaxy) return null;
  return galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;
}

/** The planet the player is presently landed on, if resolvable. */
export function landedPlanet(engine: GameEngine): Planet | null {
  const sys = currentSystem(engine);
  const landedId = engine.player?.landedPlanetId;
  if (!sys || !landedId) return null;
  return sys.planets.find((p) => p.id === landedId) ?? null;
}

/**
 * Pick a `warp` destination from `connections` — "direction of the unknown"
 * (CJM-G explorer's spec, but applied to every warp since target selection is
 * centralized here rather than per-CJM): prefer a system not yet in
 * `visited`, then fall back to anything other than `lastSystemId` (avoids
 * ping-ponging between two adjacent systems), then the first connection.
 * `avoid` (optional — Overmind-held systems, Task 3) is stripped from the
 * candidate pool first when doing so still leaves somewhere to go; when every
 * connection is avoided (a front-encircled system), it falls back to the full
 * pool rather than returning `undefined` — jumping into the front is still
 * better than not jumping at all. Pure — no engine access — so it's cheaply
 * unit-testable against a mock connections list.
 */
export function pickWarpTarget(
  connections: readonly { toSystemId: string }[],
  lastSystemId: string | null,
  visited: ReadonlySet<string>,
  avoid?: ReadonlySet<string>,
): string | undefined {
  const pool =
    avoid && avoid.size > 0
      ? (() => {
          const filtered = connections.filter((c) => !avoid.has(c.toSystemId));
          return filtered.length > 0 ? filtered : connections;
        })()
      : connections;
  return (
    pool.find((c) => !visited.has(c.toSystemId)) ??
    pool.find((c) => c.toSystemId !== lastSystemId) ??
    pool[0]
  )?.toSystemId;
}

/**
 * Accept every contract offered on the landed planet that is *registered* as a
 * template and not already active. Guarding on the registered template + the
 * active set keeps this a clean no-op (never a `logger.error`) when there is
 * nothing new to take.
 */
export function acceptBoardQuests(engine: GameEngine): void {
  const planet = landedPlanet(engine);
  if (!planet) return;
  const quests = engine.questManager;
  const active = new Set(quests.getActiveQuests().map((q) => q.id));
  for (const offered of planet.availableQuests) {
    if (active.has(offered.id)) continue;
    if (!quests.getQuestTemplate(offered.id)) continue; // not registered ⇒ skip
    quests.acceptQuest(offered.id, planet.id);
  }
}

/**
 * Sell every unit of cargo `player` holds at `planet`'s market (clones the list
 * so mutations don't affect iteration) via the real {@link TradeSystem} seam.
 * Shared by {@link executeTradeOnPlanet} and {@link executeSellAll}.
 */
function sellAllCargo(
  ts: TradeSystem,
  engine: GameEngine,
  planet: Planet,
): void {
  const player = engine.player;
  if (!player) return;
  const capacity = cargoCapacityOf(engine.playerLoadout);
  for (const cargo of [...player.inventory.resources]) {
    if (cargo.amount <= 0) continue;
    ts.executeTrade(
      player,
      planet,
      cargo.type,
      cargo.amount,
      false,
      capacity,
      engine.bank,
    );
  }
}

/**
 * Sell every unit of cargo the player holds at `planet`'s market — the explicit
 * sell-only counterpart to {@link executeTradeOnPlanet} (which also buys), backing
 * the `sell-cargo` action so "sell what I'm carrying" never accidentally re-buys.
 */
export function executeSellAll(engine: GameEngine, planet: Planet): void {
  sellAllCargo(new TradeSystem(), engine, planet);
}

/**
 * Execute simple market trades at `planet` via the real {@link TradeSystem} seam:
 * sell all held cargo at any price, then spend available credits on the cheapest
 * available good. Uses the same `executeTrade` path the {@link TradeScene} UI
 * uses — credits and cargo change, the bank ledger is posted. Dev-only helper.
 */
export function executeTradeOnPlanet(engine: GameEngine, planet: Planet): void {
  executeMemoryAwareTrade(engine, planet, null);
}

/**
 * Never let a single buy spend more than this fraction leaves in reserve —
 * a bulk buy of a known-profitable good still leaves a credit cushion rather
 * than emptying the wallet. A buy costing more than the reserve allows is not
 * blocked outright (that would forbid ever affording the *one* unit of a
 * genuinely known-profitable good), only the quantity is capped by it.
 */
const TRADE_CREDIT_RESERVE_FRACTION = 0.3;

/**
 * Memory-aware trade executor: sell all held cargo, then — only when a
 * `preferredGood` is supplied and stocked here — buy it, capped so the buy
 * never spends the whole wallet (see {@link TRADE_CREDIT_RESERVE_FRACTION}).
 *
 * `preferredGood == null` means "no known cross-planet margin" and is
 * deliberately **sell-only**: blindly buying the locally cheapest good
 * regardless of whether (or where) it can be resold is the full-wallet
 * speculation that used to drain the agent's credits into unsellable cargo
 * (see docs/plans/20260703-autopilot-goal-trading-and-npc-brains.md) — removed
 * outright rather than capped. Price discovery doesn't need a buy either: the
 * observation/memory fold already learns a landed planet's market for free.
 *
 * The {@link PlayerAgent} hands in the best cross-planet margin good known
 * from its belief state, so the agent buys for a route it already has a sell
 * destination for. Both paths use the same `executeTrade` seam as
 * {@link TradeScene}.
 */
export function executeMemoryAwareTrade(
  engine: GameEngine,
  planet: Planet,
  preferredGood: ResourceType | null,
): void {
  const player = engine.player;
  if (!player) return;
  const ts = new TradeSystem();
  const capacity = cargoCapacityOf(engine.playerLoadout);

  sellAllCargo(ts, engine, planet);

  if (preferredGood === null) return;

  const resources = planet.market?.availableResources ?? [];
  if (!resources.includes(preferredGood)) return;
  const holdUsed = player.inventory.resources.reduce((s, r) => s + r.amount, 0);
  const holdFree = Math.max(0, capacity - holdUsed);
  if (holdFree === 0) return;

  const price = ts.getBuyPrice(planet, preferredGood, player);
  if (price <= 0 || player.credits < price) return;
  const reserveSpend = Math.floor(
    player.credits * (1 - TRADE_CREDIT_RESERVE_FRACTION),
  );
  const spendable = Math.max(price, reserveSpend);
  const qty = Math.min(Math.floor(spendable / price), holdFree);
  if (qty > 0) {
    ts.executeTrade(
      player,
      planet,
      preferredGood,
      qty,
      true,
      capacity,
      engine.bank,
    );
  }
}

/**
 * Restore the player's hull at the cheapest available rate (planet-Верфь pricing:
 * 2 cr/HP). Mirrors `PlanetScene.doHullRepair` without the UI: syncs the loadout
 * max, checks affordability, deducts credits via the banking bus, then calls
 * `ship.repair()`. Safe no-op when hull is already perfect or credits are
 * insufficient. Dev-only helper — shared by `PlayerAgent.repair` and tests.
 */
export function executeRepair(engine: GameEngine): void {
  const player = engine.player;
  if (!player) return;
  const ship = player.ship;
  const loadout = engine.playerLoadout;
  if (loadout) applyLoadoutHullToShip(ship, loadout);
  const status = hullStatus(
    ship.hullHP,
    ship.maxHull,
    loadout?.derivedStats().maxHull,
  );
  if (status.isPerfect) return;
  const cost = Math.ceil(status.missing * 2);
  if (player.credits < cost) return;
  adjustPlayerCredits(
    engine.bank,
    player,
    -cost,
    GL_COUNTERPARTY.SERVICES,
    "Ремонт корпуса",
  );
  ship.repair();
}
