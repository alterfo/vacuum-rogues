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
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";

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
 * Pure — no engine access — so it's cheaply unit-testable against a mock
 * connections list.
 */
export function pickWarpTarget(
  connections: readonly { toSystemId: string }[],
  lastSystemId: string | null,
  visited: ReadonlySet<string>,
): string | undefined {
  return (
    connections.find((c) => !visited.has(c.toSystemId)) ??
    connections.find((c) => c.toSystemId !== lastSystemId) ??
    connections[0]
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
  const player = engine.player;
  if (!player) return;
  const ts = new TradeSystem();
  const capacity = cargoCapacityOf(engine.playerLoadout);

  sellAllCargo(ts, engine, planet);

  // Buy as many units of the cheapest available good as credits + hold allow
  const resources = planet.market?.availableResources ?? [];
  if (resources.length === 0) return;
  const holdUsed = player.inventory.resources.reduce((s, r) => s + r.amount, 0);
  const holdFree = Math.max(0, capacity - holdUsed);
  if (holdFree === 0) return;

  let cheapestResource: ResourceType | null = null;
  let cheapestPrice = Infinity;
  for (const res of resources) {
    const price = ts.getBuyPrice(planet, res, player);
    if (price > 0 && price < cheapestPrice) {
      cheapestPrice = price;
      cheapestResource = res;
    }
  }
  if (!cheapestResource || player.credits < cheapestPrice) return;
  const qty = Math.min(Math.floor(player.credits / cheapestPrice), holdFree);
  if (qty > 0) {
    ts.executeTrade(
      player,
      planet,
      cheapestResource,
      qty,
      true,
      capacity,
      engine.bank,
    );
  }
}
