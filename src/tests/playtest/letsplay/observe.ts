/**
 * Letsplay engine — observation surface (dev-only).
 *
 * `observe(engine)` projects the *real* {@link GameEngine}'s current state into a
 * pure, serialisable {@link Observation}: the active scene, the player's vitals
 * (credits / hull / fuel / cargo / position), the current system's planets +
 * stations + present NPCs, the active quests, and — crucially — the **set of
 * legal player actions** for the current scene. The {@link PlayerAgent} reads
 * this snapshot, a {@link PlayerPolicy} chooses one of `legalActions`, and the
 * action is applied back onto the engine through the harness.
 *
 * **Partial observability (egocentric).** The snapshot is restricted to what the
 * player could actually perceive *right now*: their own vitals/cargo/credits,
 * the current system (its planets/stations/connections and the ships present in
 * it), and — only when the player is landed — that one planet's market prices.
 * An *unvisited* planet's market is never leaked: prices live on
 * {@link CurrentPlanetSnapshot} (the landed planet), so the agent must *go there*
 * to learn them. This is what lets the agent's memory be an honest belief state
 * built solely from things it has seen.
 *
 * Everything here is a *read*: `observe` mutates nothing and never throws on a
 * partially-initialised engine (e.g. the main menu before a game starts), so it
 * is safe to call on every step. It lives under `src/tests/` and is **dev-only**
 * — no production module imports it (enforced by `letsplayDevOnly.test.ts`).
 */
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType, StationType, FactionType } from "@/types";
import type { ResourceType, QuestType } from "@/types";
import { npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { isDowned } from "@/systems/combat/godMode";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { TradeSystem } from "@/systems/TradeSystem";
import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";
import {
  hasStationOfType,
  hasBankAccess,
  isNearOvermindCore,
  overmindShareOf,
  isQuestDeliveryHere,
  loanStatusOf,
  systemShopPrices,
} from "./observeHelpers";
import {
  bestAffordableGear,
  hullUpgradeNetCost,
  cheapestMicromodule,
  planArmUp,
} from "./equipmentQueries";
import { hullTradeInPrice } from "@/systems/equipment/sellHull";
import { micromodulePrice } from "@/systems/equipment/micromoduleShop";
import {
  takeableBoardQuestCount,
  reachableNeighbors,
  questRoutingPreference,
  systemHopDistances,
  overmindFrontHopDistances,
  repairCost,
} from "./engineQueries";

/**
 * Pricing is stateless (base prices + a heuristic regressor), so a single
 * shared instance is reused for every egocentric market read. It is never
 * mutated by {@link observe}, keeping the projection a pure read.
 */
const TRADE = new TradeSystem();

/**
 * The vocabulary of player actions the agent can take. A superset across all
 * scenes; {@link legalActionsForScene} narrows it to what the *current* scene
 * actually permits.
 */
export type PlayerActionKind =
  | "move" // fly / take off / leave a sub-screen back toward flight
  | "warp" // jump to a connected system
  | "land" // land on a planet (flight → planet)
  | "dock" // dock at a station (flight → station)
  | "trade" // buy/sell at a market (planet or trade screen)
  | "take-quest" // accept a contract offered at the current location
  | "attack" // fire on a hostile in range
  | "flee" // disengage from a hostile
  | "repair" // restore hull at a repair-capable base
  | "wait" // pass / advance a frame
  | "buy-gear" // purchase a weapon/equipment/engine at a shop
  | "upgrade-hull" // swap to a better hull at the equipment shop
  | "buy-module" // buy a micromodule at a CRAFT_CENTER station
  | "take-loan" // borrow credits from the bank
  | "repay-loan" // repay an outstanding loan
  | "sell-cargo" // explicit sell-only action (vs. trade, which also buys)
  | "arm-up" // buy + install a stronger weapon (raise installed firepower)
  | "liberate"; // free the current (garrison-cleared) captured system

/**
 * Canonical action order so two equal states yield identical `legalActions`.
 * Also the fixed **action vocabulary** a neural policy's output head indexes into
 * (`NeuralPolicy` maps `scores[i]` → `ACTION_ORDER[i]`), so the ordering is a
 * single source of truth shared by the legal-action surface and the net seam.
 * The original 10-action order is preserved verbatim (several tests pin its
 * exact sequence) — the 6 new actions are appended, not interleaved.
 */
export const ACTION_ORDER: readonly PlayerActionKind[] = [
  "move",
  "warp",
  "land",
  "dock",
  "trade",
  "take-quest",
  "attack",
  "flee",
  "repair",
  "wait",
  "buy-gear",
  "upgrade-hull",
  "buy-module",
  "take-loan",
  "repay-loan",
  "sell-cargo",
];

/**
 * `liberate` is deliberately kept OUT of {@link ACTION_ORDER}: that array is also
 * the frozen neural-net output vocabulary (`weightsContract.test.ts` /
 * `shippedWeights.test.ts` pin it at 16 and the shipped `player.weights.json` has
 * a 16-wide output head — growing it needs a retrain + re-export, out of scope
 * here). Appending it here instead keeps `legalActionsForScene`'s deterministic
 * ordering total over the full {@link PlayerActionKind} vocabulary without
 * touching the net contract: {@link mapNetOutputToAction} only ranks
 * `ACTION_ORDER` slots, so the trained net simply never scores `liberate` (falls
 * through to the next best legal action) — no regression for the neural policy,
 * and `MemoryHeuristicPolicy` (which reads `obs.legalActions` directly) sees it.
 *
 * `arm-up` (buy + install a stronger weapon, the Task 2 military-progression
 * lever) is appended here for the identical reason — it is not part of the
 * frozen neural output vocabulary, so the trained net never scores it while the
 * heuristic ladder can rank it.
 */
const LEGAL_ACTION_ORDER: readonly PlayerActionKind[] = [
  ...ACTION_ORDER,
  "arm-up",
  "liberate",
];

/** Minimum credits on hand for `buy-module` to be legal at a CRAFT_CENTER station. */
const BUY_MODULE_MIN_CREDITS = 800;

/** Player vitals + cargo + world position. */
export interface PlayerSnapshot {
  credits: number;
  hull: number;
  maxHull: number;
  /** `hull / maxHull` in `[0, 1]` (0 when `maxHull` is 0). */
  hullFraction: number;
  /**
   * Installed weapon damage from the canonical loadout (`derivedStats`) — the
   * ship's actual firepower, not what it merely owns. Feeds the Task 2
   * "battle-ready" signal (`maxHull` + `weaponDamage` thresholds) that gates the
   * Overmind-slayer progression. `0` with no loadout / no weapon fitted.
   * Optional so older hand-built fixtures (which predate the field) still
   * type-check; absent is treated as `0` (not battle-ready) everywhere.
   */
  weaponDamage?: number;
  /** Reactor energy doubles as warp fuel (the star-map "ТОПЛИВО" gauge). */
  fuel: number;
  maxFuel: number;
  fuelFraction: number;
  cargo: { type: ResourceType; amount: number }[];
  /** Sum of cargo amounts currently held. */
  cargoUsed: number;
  /** Hold size from the canonical loadout (0 with no loadout). */
  cargoCapacity: number;
  systemId: string;
  /** Live/last in-flight ship position, when one is known. */
  position: { x: number; y: number } | null;
  /**
   * Reputation with the lawful/banking faction (BASTIONS), [-100,100]. Feeds
   * the Task 5 feature vector as a "military/ranger zone" standing proxy — the
   * game has no literal Ranger faction (see CJM-F's pirate policy, which
   * substitutes the same faction for the identical reason).
   */
  reputationBastions?: number;
  /** Reputation with the black-market faction (SYNDICATE), [-100,100] — the "pirate/outlaw" standing proxy. */
  reputationSyndicate?: number;
  /**
   * `isDowned(player)` (Task 6) — GOD mode only: the hull sits at the GOD
   * floor, so the ship can neither FIRE nor HYPERJUMP until repaired (the
   * star-map jump gate shows «Корабль повреждён — нужен ремонт»). The policy
   * must not emit fight/flee for a downed ship — both are engine-blocked, and
   * retrying the blocked jump forever was the day-182 capacity wedge. Never
   * true on NORMAL/HARD. Optional so pre-Task-6 fixtures are unaffected.
   */
  downed?: boolean;
  /**
   * The wallet covers `executeRepair`'s bill right now (Task 6) — the policy
   * gate for `dock-to-repair`: docking to buy a repair the ship cannot pay
   * for ping-pongs dock→leave→dock forever (repair itself is already
   * legality-gated at the STATION via `canAffordRepair`). `true` when the
   * hull is perfect (a no-op repair "costs" nothing). Optional: absent
   * (pre-Task-6 fixtures) ⇒ treated as affordable, the legacy behaviour.
   */
  canAffordRepair?: boolean;
}

/** The player's current star system + what's reachable from it. */
export interface SystemSnapshot {
  id: string;
  name: string;
  planets: {
    id: string;
    name: string;
    availableQuests: number;
    isHabitable?: boolean;
  }[];
  stations: { id: string; name: string; type: StationType }[];
  /** Number of warp paths leading out of this system. */
  connections: number;
  /**
   * The identity of each connected system (Task 5) — replaces the blind
   * `connections` count for target selection: `visited` is real fog-of-war
   * (`StarSystem.explored`), `overmindHeld` is `Galaxy.isOvermindSystem`.
   * Optional so older hand-built `Observation` fixtures (which only set
   * `connections`) still type-check; the policy falls back to a blind pick
   * when this is absent.
   */
  neighbors?: {
    systemId: string;
    visited: boolean;
    overmindHeld: boolean;
    /**
     * `Galaxy.isPirateSystem` (Task 6) — the star map renders pirate-held
     * systems orange for the player, so this is observation PARITY, not
     * agent-only intel: a pirate den hosts a standing 5–10-ship garrison
     * that annihilates a non-battle-ready ship, and the warp picker must
     * weigh it exactly like Overmind-held danger (a human reading the map
     * would). Optional so pre-Task-6 fixtures keep their exact decisions.
     */
    pirateHeld?: boolean;
    /**
     * BFS hop-distance from this neighbour to a carried DELIVERY quest's
     * target system (Task 2, `systemHopDistances`) — lets the policy's warp
     * tie-break greedily walk toward a KNOWN multi-hop destination instead of
     * only ever recognising a target one jump away. `undefined` with no
     * active quest target or when this neighbour can't reach it.
     */
    hopsToQuestTarget?: number;
    /**
     * Multi-source BFS hop-distance from this neighbour to the NEAREST
     * Overmind-held system (Task 3, `overmindFrontHopDistances`) — `0` when the
     * neighbour is itself held, `1` when it borders the front, etc. Lets the
     * Overmind-slayer tier route a battle-ready ship *toward* the front by
     * minimising this value (the mirror of `hopsToQuestTarget`). `undefined`
     * when no Overmind front exists yet or the neighbour can't reach it.
     */
    hopsToOvermindFront?: number;
  }[];
}

/** A single NPC ship present (not in transit) in the player's system. */
export interface NpcSnapshot {
  id: string;
  name: string;
  faction: FactionType;
  hostile: boolean;
  hullHP: number;
  /**
   * The ship's per-volley weapon damage (Task 6) — what the policy's
   * kill-time calculus (`flee-outgunned`) weighs a potential fight with.
   * Optional so hand-built fixtures that predate it keep their exact
   * decisions (absent ⇒ 0 ⇒ the hostile is treated as harmless-if-weaker,
   * the pre-Task-6 behavior).
   */
  damage?: number;
}

/** An active contract the player is carrying. */
export interface QuestSnapshot {
  id: string;
  title: string;
  type: QuestType;
  targetSystemId: string | null;
  /**
   * The contract's specific target planet, when it names one. In-system
   * courier runs («Местный подряд») only complete on this planet, so the
   * autopilot must land here — not blindly on `planets[0]`. Optional so
   * existing snapshot fixtures that predate the field still type-check.
   */
  targetPlanetId?: string | null;
  /**
   * The contract's own credit payout — lets a decision check profitability
   * against a KNOWN number instead of guessing (see `deliveryCargoNeed`).
   * Optional so existing snapshot fixtures that predate the field still
   * type-check; a fixture that omits it never has a `collectItem` either, so
   * `deliveryCargoNeed` never reads it as a real 0-reward contract.
   */
  rewardCredits?: number;
  /**
   * A DELIVERY quest's unmet COLLECT_ITEM requirement, ground-truthed against
   * the player's actual cargo (not the objective's own progress counter, which
   * nothing in production advances). `null`/absent for quests with no cargo
   * requirement (already satisfied, or not a COLLECT_ITEM objective at all).
   */
  collectItem?: {
    type: ResourceType;
    required: number;
    carried: number;
  } | null;
}

/**
 * One tradeable good's prices at the player's current location. Egocentric: a
 * good's `buy`/`sell` is only knowable by *being at* the planet that trades it,
 * so these appear on {@link CurrentPlanetSnapshot} (the landed planet) and
 * nowhere else — unvisited planets expose no prices.
 */
export interface MarketGoodSnapshot {
  resource: ResourceType;
  /** Price to buy one unit here. */
  buy: number;
  /** Price to sell one unit here (always strictly below `buy` on this planet). */
  sell: number;
}

/** The planet the player is currently landed on (PLANET scene). */
export interface CurrentPlanetSnapshot {
  id: string;
  name: string;
  availableQuests: number;
  /**
   * The goods + prices visible *because the player is landed here*. The only
   * place market prices appear in the snapshot — this is the perception the
   * agent's price-book memory is fed from.
   */
  market: MarketGoodSnapshot[];
}

/** A pure, serialisable snapshot of the engine state the agent reasons over. */
export interface Observation {
  scene: SceneType;
  hasPlayer: boolean;
  player: PlayerSnapshot | null;
  system: SystemSnapshot | null;
  /** The landed planet, when in the PLANET scene with a resolvable landing. */
  currentPlanet: CurrentPlanetSnapshot | null;
  npcs: NpcSnapshot[];
  /** Convenience subset of `npcs` flagged hostile to the player. */
  hostiles: NpcSnapshot[];
  quests: QuestSnapshot[];
  legalActions: PlayerActionKind[];
  /**
   * True when the ship is mid-transit to the system edge (a pending hyperjump was
   * initiated and SpaceFlightScene is flying the ship out). The policy should push
   * `wait` or `move` instead of re-opening StarMap, which would cancel the warp.
   * Optional so test fixtures that build `Observation` objects without it still
   * type-check; absent is treated as `false` everywhere.
   */
  warpInTransit?: boolean;
  /** A bank is reachable from the current location (any planet, or a TRADE_POST/MILITARY_BASE station). */
  hasBank?: boolean;
  /** The current system fields a CRAFT_CENTER station (micromodule shop). */
  hasCraftCenter?: boolean;
  /** The current system fields a REPAIR_DOCK station. */
  hasRepairDock?: boolean;
  /** Fraction (0..1) of the galaxy's systems currently Overmind-controlled. */
  overmindShare?: number;
  /** The current system is (or is one warp hop from) the Overmind core system. */
  nearOvermindCore?: boolean;
  /**
   * The player's CURRENT system is Overmind-held (`Galaxy.isOvermindSystem`, or
   * the core itself before its garrison spread catches up). The Overmind-slayer
   * tier (Task 3) reads this as "I'm standing at the front on a liberation
   * mission" — the ONLY place it overrides `flee-outmatched` to stand and clear
   * a garrison, and where a cleared system becomes `liberate`-able. Defaults to
   * false. Distinct from `nearOvermindCore` (adjacency to the core), which stays
   * true one hop out where there is no garrison to fight yet.
   */
  overmindHeldHere?: boolean;
  /**
   * Every system currently held by a hostile faction (Overmind incl. the core
   * + pirate dens), galaxy-wide. Observation-parity with the real star map,
   * which renders ALL captured systems (red/orange) regardless of distance —
   * a human player never plots a trade route into one. Lets the routed trips
   * (`go-stock`/`go-restock`/targeted sell legs, Task 7) refuse a remembered
   * destination that was captured SINCE it was last visited: the threatMap is
   * ship-scoped memory and never learns about a far-off capture, so on the
   * campaign horizon the spread front routinely swallowed a remembered
   * cheap-buy system and the ladder flew straight into the new garrison
   * (measured: the day-255 pinned-at-the-front wedge). Optional so existing
   * fixtures type-check; absent ⇒ no destination is refused (legacy).
   */
  hostileSystemIds?: readonly string[];
  /** A carried quest's delivery system is the player's current system. */
  questDeliveryHere?: boolean;
  /** The player currently owes an outstanding bank loan. */
  activeLoans?: boolean;
  /** Outstanding loan balance, present only alongside `activeLoans: true`. */
  loanBalance?: number;
  /** Consecutive missed loan payments, present only alongside `activeLoans: true`. */
  loanMissedPayments?: number;
  /**
   * Cheapest non-hull gear price in the CURRENT system's shops (every planet
   * fields one), `null` when the system has no shop at all. Egocentric like the
   * market: an unvisited system's shop is never priced.
   */
  cheapestGearPrice?: number | null;
  /** Cheapest hull price in the CURRENT system's (planet-only) shops, `null` if none. */
  bestHullPrice?: number | null;
  /**
   * A weapon refit in the CURRENT system would raise installed firepower — an
   * owned gun can be fitted, or a stronger one is affordable in-shop (mirrors
   * `canArmUp`/`planArmUp`). Lets the flight ladder decide to dock-and-refit
   * for the Task 2 battle-ready push even though `arm-up` itself is only legal
   * once actually at a shop. Defaults to false.
   */
  canArmUp?: boolean;
  /**
   * Credits the next `arm-up` would spend right now (the price of the weapon it
   * would buy), or `0` when it fields an already-owned spare gun for free.
   * Lets the policy arm up only from genuine surplus — keeping enough trade
   * capital to keep earning — rather than bankrupting itself on a weapon the
   * instant it can technically afford one. Defaults to 0.
   */
  armUpCost?: number;
  /**
   * Credits the next `buy-gear` would spend right now — the price of the gear
   * `executeBuyBestGear` (the PRICIEST affordable listing, not the cheapest)
   * would actually buy; `null` when nothing is affordable/stocked. The
   * decision gate must weigh this exact number (Task 7): gating on
   * `cheapestGearPrice` while the executor buys the best let a single
   * "affordable" shopping step spend 3179cr against a ~980cr gate check and
   * walk the campaign wallet from its 5171cr peak to 74cr in two folds.
   */
  buyGearCost?: number | null;
  /**
   * Credits the next `buy-module` would spend right now — the price of the
   * cheapest not-yet-owned micromodule `executeBuyBestModule` would buy;
   * `null` when none is affordable/unowned (mirrors `hasAffordableModule`).
   * Same executor-truth reasoning as `buyGearCost`.
   */
  buyModuleCost?: number | null;
  /**
   * Credits the next `upgrade-hull` would spend right now — the price of the
   * hull `executeUpgradeHull` (the PRICIEST affordable genuine upgrade over
   * the fitted hull) would actually buy; `null` when no improving hull is
   * affordable/stocked. Same executor-truth reasoning as `buyGearCost`:
   * `bestHullPrice` is the CHEAPEST improving hull, so gating the reserve on
   * it while the executor buys the priciest lets the buy break the reserve.
   */
  upgradeHullCost?: number | null;
  /**
   * The galaxy's current business day (`galaxy.gameDays`). Lets
   * {@link updateMemory} detect a day-boundary transition purely from folded
   * observations (no memory field otherwise carries calendar time) — feeds the
   * Task 5 `daysWithoutCreditGain` / `overmindDaysSeen` belief tracking.
   */
  gameDay?: number;
  /** Total quests completed so far this run (`questManager.getCompletedQuestIds().length`). */
  questsCompleted?: number;
}

/** Flags describing the current location, fed to {@link legalActionsForScene}. */
export interface LegalActionContext {
  hasPlayer: boolean;
  planetCount: number;
  stationCount: number;
  hostileCount: number;
  connectionCount: number;
  /** Contracts offered at the current location (the landed planet). */
  availableQuestCount: number;
  /** Player's current credit balance — gates shop/loan affordability. Defaults to 0. */
  credits?: number;
  /** Cargo units currently held — gates the explicit `sell-cargo` action. Defaults to 0. */
  cargoUsed?: number;
  /** The current system fields a CRAFT_CENTER station. Defaults to false. */
  hasCraftCenter?: boolean;
  /**
   * At least one not-yet-owned micromodule is currently affordable — mirrors
   * `cheapestMicromodule(engine) != null`, what `executeBuyBestModule` actually
   * needs to do anything. Without this gate `buy-module` stays legal after the
   * player owns every affordable module, so the executor no-ops and the
   * autopilot soft-locks re-picking it at a STATION. Defaults to `true` so pure
   * fixtures (which never simulate a module shop) keep their prior legality.
   */
  hasAffordableModule?: boolean;
  /** The player currently owes an outstanding bank loan. Defaults to false. */
  activeLoans?: boolean;
  /** Cheapest non-hull gear price in the current system's shops, null/undefined if none. */
  cheapestGearPrice?: number | null;
  /** Cheapest hull price in the current system's (planet) shops, null/undefined if none. */
  bestHullPrice?: number | null;
  /** The current system is a captured (Overmind/pirate) system with its hostile garrison cleared — mirrors `canPlayerLiberate`. Defaults to false. */
  canLiberate?: boolean;
  /** A weapon refit would raise installed firepower right now — mirrors `canArmUp`. Defaults to false. */
  canArmUp?: boolean;
  /**
   * The ship has hull damage to restore (`hull < maxHull`) — gates the STATION
   * `repair` action so a full-hull agent can't soft-lock re-picking a no-op
   * repair instead of undocking. Defaults to `true` so pure fixtures (which
   * don't model hull) keep `repair` unconditionally legal as before.
   */
  needsRepair?: boolean;
  /**
   * The player can PAY for the repair (`credits ≥ executeRepair`'s cost,
   * Task 6) — the second half of the repair no-op gate: `executeRepair`
   * silently returns when unaffordable, so a broke, hull-damaged agent
   * re-picking "repair" forever was the day-189 capacity wedge (300× no-op
   * repairs at 83cr against a 266cr bill). Defaults to `true` so pure
   * fixtures keep `repair` legality unchanged.
   */
  canAffordRepair?: boolean;
}

/**
 * The legal player actions for `scene` given the location `ctx`. Pure and
 * exhaustive — every {@link SceneType} maps to a deterministic action set, so
 * the policy can never be handed an action the scene can't perform (e.g. "trade"
 * only where a market exists, "attack"/"flee" only with a hostile present).
 */
export function legalActionsForScene(
  scene: SceneType,
  ctx: LegalActionContext,
): PlayerActionKind[] {
  const set = new Set<PlayerActionKind>();

  // With no player (pre-game menus) the only "action" is to advance.
  if (!ctx.hasPlayer) {
    return ["wait"];
  }

  switch (scene) {
    case SceneType.SPACE_FLIGHT: {
      set.add("move");
      set.add("wait");
      if (ctx.connectionCount > 0) set.add("warp");
      if (ctx.planetCount > 0) set.add("land");
      if (ctx.stationCount > 0) set.add("dock");
      if (ctx.hostileCount > 0) {
        set.add("attack");
        set.add("flee");
      }
      if (ctx.canLiberate) set.add("liberate");
      break;
    }
    case SceneType.PLANET: {
      // A landed ship can shop the planet market, take offered work or take off.
      set.add("trade");
      set.add("move");
      set.add("wait");
      if (ctx.availableQuestCount > 0) set.add("take-quest");
      if ((ctx.cargoUsed ?? 0) > 0) set.add("sell-cargo");
      // Every planet fields a Верфь (its shop stocks hulls + gear — the source
      // of `bestHullPrice`/`cheapestGearPrice`, both "planet-only"), so the
      // military-progression refit levers are legal here too, gated on the same
      // affordability / improvement signals as the station hub. This is what
      // makes "become battle-ready" reachable in ordinary play: the agent lands
      // on planets constantly but docks at (sparse) stations rarely.
      if (
        ctx.bestHullPrice != null &&
        (ctx.credits ?? 0) >= ctx.bestHullPrice
      ) {
        set.add("upgrade-hull");
      }
      if (ctx.canArmUp) set.add("arm-up");
      break;
    }
    case SceneType.TRADE: {
      set.add("trade");
      set.add("move");
      set.add("wait");
      if ((ctx.cargoUsed ?? 0) > 0) set.add("sell-cargo");
      break;
    }
    case SceneType.STATION: {
      // Off-planet bases repair/refit; leaving returns to flight. Also the
      // shortcut hub that routes to the equipment shop / bank sub-screens.
      // Gate `repair` on actual hull damage: a full-hull repair is a no-op, and
      // since the STATION ladder ranks `repair` above `move` (leave), leaving it
      // always-legal soft-locks a docked, patched-up agent re-picking the no-op
      // forever instead of undocking — the same "no-op stays legal → autopilot
      // re-picks it" trap already guarded for buy-gear/upgrade-hull/buy-module
      // just below. Defaults `true` so pure fixtures keep their prior legality.
      // `canAffordRepair` is the same trap's other half: `executeRepair`
      // no-ops when the bill exceeds the wallet, so an unaffordable repair
      // must not be offered either (Task 6).
      if ((ctx.needsRepair ?? true) && (ctx.canAffordRepair ?? true))
        set.add("repair");
      set.add("move");
      set.add("wait");
      // A station is the hub that routes to the equipment shop, so gate
      // buy-gear/upgrade-hull on the same system-shop affordability signals as
      // EQUIPMENT_SHOP. Ungated, the NeuralPolicy could argmax to upgrade-hull
      // at a station stocking only equal/weaker (or unaffordable) hulls; the
      // executor no-ops and the autopilot soft-locks re-picking it — an
      // oracle-invisible loop, since it isn't a `wait`.
      if (
        ctx.cheapestGearPrice != null &&
        (ctx.credits ?? 0) >= ctx.cheapestGearPrice
      ) {
        set.add("buy-gear");
      }
      if (
        ctx.bestHullPrice != null &&
        (ctx.credits ?? 0) >= ctx.bestHullPrice
      ) {
        set.add("upgrade-hull");
      }
      if (
        ctx.hasCraftCenter &&
        (ctx.credits ?? 0) >= BUY_MODULE_MIN_CREDITS &&
        (ctx.hasAffordableModule ?? true)
      ) {
        set.add("buy-module");
      }
      // Gate on `canArmUp` (a real firepower improvement is available) exactly
      // like `buy-module` gates on `hasAffordableModule` — else the executor
      // no-ops and the autopilot soft-locks re-picking it.
      if (ctx.canArmUp) set.add("arm-up");
      if (ctx.activeLoans) set.add("repay-loan");
      else set.add("take-loan");
      break;
    }
    case SceneType.EQUIPMENT_SHOP: {
      set.add("move");
      set.add("wait");
      if (
        ctx.cheapestGearPrice != null &&
        (ctx.credits ?? 0) >= ctx.cheapestGearPrice
      ) {
        set.add("buy-gear");
      }
      if (
        ctx.bestHullPrice != null &&
        (ctx.credits ?? 0) >= ctx.bestHullPrice
      ) {
        set.add("upgrade-hull");
      }
      if (ctx.canArmUp) set.add("arm-up");
      break;
    }
    case SceneType.BANK: {
      set.add("move");
      set.add("wait");
      if (ctx.activeLoans) set.add("repay-loan");
      else set.add("take-loan");
      break;
    }
    case SceneType.STAR_MAP: {
      // The galaxy map's whole job is choosing a warp destination.
      set.add("move");
      set.add("wait");
      if (ctx.connectionCount > 0) set.add("warp");
      break;
    }
    case SceneType.WIN_SCREEN:
    case SceneType.GAME_OVER: {
      // Terminal screens — nothing to do but observe.
      set.add("wait");
      break;
    }
    default: {
      // Dialogue / inventory / government / info / text-quest: sub-screens the
      // agent can read and back out of.
      set.add("move");
      set.add("wait");
      break;
    }
  }

  return LEGAL_ACTION_ORDER.filter((a) => set.has(a));
}

/**
 * Egocentric market read: the buy/sell price for every good the *landed* planet
 * trades, priced for this player. Only ever called for the planet the player is
 * standing on, so an unvisited planet's prices are never produced. Order follows
 * the market's `availableResources` so two reads of one state are deep-equal.
 */
export function marketSnapshotFor(
  planet: Planet,
  player: Player,
): MarketGoodSnapshot[] {
  return planet.market.availableResources.map((resource) => ({
    resource,
    buy: TRADE.getBuyPrice(planet, resource, player),
    sell: TRADE.getSellPrice(planet, resource, player),
  }));
}

/**
 * The active-quest projection shared by {@link observe} and the live autopilot's
 * `openTrade` (which needs the same `QuestSnapshot[]` to find a carried
 * DELIVERY quest's cargo need without re-deriving this mapping).
 */
export function buildQuestSnapshots(
  engine: GameEngine,
  player: Player,
): QuestSnapshot[] {
  return engine.questManager.getActiveQuests().map((q) => {
    const collectObj = q.objectives.find(
      (o) => o.type === "COLLECT_ITEM" && !o.completed && o.itemType,
    );
    const carried = collectObj
      ? (player.inventory.resources.find((r) => r.type === collectObj.itemType)
          ?.amount ?? 0)
      : 0;
    return {
      id: q.id,
      title: q.title,
      type: q.type,
      targetSystemId: q.targetSystemId ?? null,
      targetPlanetId: q.targetPlanetId ?? null,
      rewardCredits: q.reward.credits,
      collectItem: collectObj
        ? {
            type: collectObj.itemType as ResourceType,
            required: collectObj.targetAmount,
            carried,
          }
        : null,
    };
  });
}

/**
 * Project the live engine into an {@link Observation}. Read-only and total — a
 * partially-initialised engine (e.g. on the main menu, before a game) yields
 * `hasPlayer: false` with a `["wait"]` action set rather than throwing.
 *
 * `completedQuestsBaseline` is the caller's {@link AgentMemory.completedQuestsBaseline}
 * (or the equivalent "no completions yet this session" reading) — threaded into
 * `takeableBoardQuestCount` so a session hooked into a save that already has
 * unrelated completed quests doesn't read the lifetime cap as already tripped
 * and silently make `take-quest` illegal from the very first observation.
 * Defaults to 0 (today's behaviour) for callers with no session memory
 * (diagnostics/exporters that always start from a fresh game).
 */
export function observe(
  engine: GameEngine,
  completedQuestsBaseline = 0,
): Observation {
  const scene = engine.currentSceneType;
  const player = engine.player;
  const galaxy = engine.galaxy;

  if (!player || !galaxy) {
    return {
      scene,
      hasPlayer: false,
      player: null,
      system: null,
      currentPlanet: null,
      npcs: [],
      hostiles: [],
      quests: [],
      legalActions: legalActionsForScene(scene, {
        hasPlayer: false,
        planetCount: 0,
        stationCount: 0,
        hostileCount: 0,
        connectionCount: 0,
        availableQuestCount: 0,
      }),
      warpInTransit: false,
      hasBank: false,
      hasCraftCenter: false,
      hasRepairDock: false,
      overmindShare: 0,
      nearOvermindCore: false,
      questDeliveryHere: false,
      activeLoans: false,
      cheapestGearPrice: null,
      bestHullPrice: null,
      gameDay: 0,
      questsCompleted: 0,
    };
  }

  const ship = player.ship;
  const cargoCapacity = cargoCapacityOf(engine.playerLoadout);
  const cargo = player.inventory.resources.map((r) => ({
    type: r.type,
    amount: r.amount,
  }));
  const cargoUsed = cargo.reduce((sum, r) => sum + r.amount, 0);
  const flightPos =
    engine.liveFlightShipPos ?? engine.lastFlightShipPos ?? null;

  const playerSnapshot: PlayerSnapshot = {
    credits: player.credits,
    hull: ship.hullHP,
    maxHull: ship.maxHull,
    hullFraction: ship.maxHull > 0 ? ship.hullHP / ship.maxHull : 0,
    weaponDamage: engine.playerLoadout?.derivedStats().weaponDamage ?? 0,
    fuel: ship.energy,
    maxFuel: ship.maxEnergy,
    fuelFraction: ship.maxEnergy > 0 ? ship.energy / ship.maxEnergy : 0,
    cargo,
    cargoUsed,
    cargoCapacity,
    systemId: player.currentSystemId,
    position: flightPos ? { x: flightPos.x, y: flightPos.y } : null,
    reputationBastions: player.getReputation(FactionType.BASTIONS),
    reputationSyndicate: player.getReputation(FactionType.SYNDICATE),
    downed: isDowned(player),
    canAffordRepair: player.credits >= (repairCost(engine) ?? 0),
  };

  const system =
    galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;

  const quests: QuestSnapshot[] = buildQuestSnapshots(engine, player);

  // Multi-hop routing bias (Task 2): the target of a carried DELIVERY quest
  // that isn't the current system, and each of this system's real neighbours'
  // BFS hop-distance to it — computed once here (the only place `observe`
  // already has full `galaxy.systems` access) and stamped onto each neighbour
  // below so `pickWarpNeighbor`'s tie-break can walk toward it without a
  // second engine-graph read at decide-time.
  const questTargetSystemId = questRoutingPreference(
    quests,
    system?.id ?? null,
  );
  const hopsToQuestTarget =
    questTargetSystemId != null
      ? systemHopDistances(galaxy.systems, questTargetSystemId)
      : null;

  // Front routing (Task 3): distance from every system to the nearest
  // Overmind-held one, so a battle-ready ship can walk *toward* the front. The
  // seed set mirrors the per-neighbour `overmindHeld` flag below — the core
  // counts as held even before `addOvermindSystem` catches up (garrison spread
  // lags core placement), so a slayer routing toward the front still homes on
  // the core itself. Empty map (no field) when no front exists yet.
  const overmindFrontSeeds =
    galaxy.overmindCoreSystemId !== "" &&
    !galaxy.overmindSystems.includes(galaxy.overmindCoreSystemId)
      ? [...galaxy.overmindSystems, galaxy.overmindCoreSystemId]
      : galaxy.overmindSystems;
  const hopsToOvermindFront =
    overmindFrontSeeds.length > 0
      ? overmindFrontHopDistances(galaxy.systems, overmindFrontSeeds)
      : null;
  // Every hostile-held system galaxy-wide (see `hostileSystemIds` doc) — the
  // same union the applier's blind warp pick avoids and the star map renders.
  const hostileSystemIds = [...overmindFrontSeeds, ...galaxy.pirateSystems];

  const systemSnapshot: SystemSnapshot | null = system
    ? {
        id: system.id,
        name: system.name,
        planets: system.planets.map((p) => ({
          id: p.id,
          name: p.name,
          // `p.availableQuests` is a static, always-empty generation-time
          // field — the real job board is generated on demand (EPIC-008) via
          // `getQuestBoard`, exactly what `PlanetScene.openJobBoard` reads.
          // Reading the dead field here silently starved `take-quest` (it was
          // never legal, "availableQuestCount" was always 0). Counted via the
          // same takeable filter `acceptBoardQuests` applies — an untakeable
          // TEXT_ADVENTURE offer that's never accepted never leaves the board,
          // so counting it here would make the take-quest tier fire forever.
          availableQuests: takeableBoardQuestCount(
            engine,
            p.id,
            completedQuestsBaseline,
          ),
          isHabitable: p.isHabitable,
        })),
        stations: system.stations.map((st) => ({
          id: st.id,
          name: st.name,
          type: st.type,
        })),
        connections: system.connections.length,
        // `reachableNeighbors`, not raw `system.connections`: the galaxy's
        // nearest-neighbour generation pass adds each edge on only ONE side,
        // but the engine allows warping either direction — reading the raw
        // one-directional list here silently hid real, immediately-warpable
        // neighbours (including a carried quest's own target) from every
        // decision this snapshot feeds. See `reachableNeighbors`'s own doc.
        neighbors: reachableNeighbors(galaxy.systems, system.id).map((c) => ({
          systemId: c.toSystemId,
          visited:
            galaxy.systems.find((s) => s.id === c.toSystemId)?.explored ??
            false,
          // The core itself counts as "held" even before `addOvermindSystem`
          // has caught up to it (garrison spread lags core placement) — a
          // "flee the front" warp should never target the front's own core.
          overmindHeld:
            galaxy.isOvermindSystem(c.toSystemId) ||
            (galaxy.overmindCoreSystemId !== "" &&
              c.toSystemId === galaxy.overmindCoreSystemId),
          pirateHeld: galaxy.isPirateSystem(c.toSystemId),
          hopsToQuestTarget: hopsToQuestTarget?.get(c.toSystemId),
          hopsToOvermindFront: hopsToOvermindFront?.get(c.toSystemId),
        })),
      }
    : null;

  const npcs: NpcSnapshot[] = system
    ? npcsPresentInSystem(galaxy, system.id).map((n) => ({
        id: n.id,
        name: n.name,
        faction: n.race,
        hostile: n.hostile,
        hullHP: n.hullHP,
        damage: n.damage,
      }))
    : [];
  const hostiles = npcs.filter((n) => n.hostile);

  // The landed planet (PLANET scene), used to gate "take-quest".
  const landed =
    player.landedPlanetId && system
      ? (system.planets.find((p) => p.id === player.landedPlanetId) ?? null)
      : null;
  const currentPlanet: CurrentPlanetSnapshot | null = landed
    ? {
        id: landed.id,
        name: landed.name,
        // Reuse the board already computed into `systemSnapshot` above rather
        // than calling `getQuestBoard` a second time for the same planet.
        availableQuests:
          systemSnapshot?.planets.find((p) => p.id === landed.id)
            ?.availableQuests ?? 0,
        market: marketSnapshotFor(landed, player),
      }
    : null;

  // For the PLANET scene, the offered-quest count is the landed planet's if
  // known, else the best any planet in-system offers (the agent could land).
  const availableQuestCount =
    currentPlanet?.availableQuests ??
    (systemSnapshot
      ? systemSnapshot.planets.reduce(
          (max, p) => Math.max(max, p.availableQuests),
          0,
        )
      : 0);

  // Bank / equipment / Overmind / quest-delivery signals (Task 1). All derived
  // from the current system + real engine state, guarded for a systemless state.
  // Computed before `legalActions` below, which gates the shop/loan/sell-cargo
  // actions on several of these signals.
  const hasCraftCenter = system
    ? hasStationOfType(system.stations, StationType.CRAFT_CENTER)
    : false;
  const hasRepairDock = system
    ? hasStationOfType(system.stations, StationType.REPAIR_DOCK)
    : false;
  const hasBank = system
    ? hasBankAccess(currentPlanet != null, system.stations)
    : false;
  const overmindShare = overmindShareOf(
    galaxy.overmindSystems.length,
    galaxy.systems.length,
  );
  const nearOvermindCore = isNearOvermindCore(
    system,
    galaxy.overmindCoreSystemId,
  );
  // The current system itself is Overmind-held — the "at the front" gate the
  // slayer tier uses to override flee and to recognise a liberate-able system.
  // Mirrors the per-neighbour `overmindHeld` seed set (the core counts as held
  // even before its garrison spread catches up).
  const overmindHeldHere =
    system != null &&
    (galaxy.isOvermindSystem(system.id) ||
      (galaxy.overmindCoreSystemId !== "" &&
        system.id === galaxy.overmindCoreSystemId));
  const questDeliveryHere = isQuestDeliveryHere(quests, player.currentSystemId);
  const loanStatus = loanStatusOf(engine.bankingService, player.id);
  const { cheapestGearPrice, bestHullPrice } = system
    ? systemShopPrices({
        seed: galaxy.id,
        day: galaxy.gameDays,
        system: {
          id: system.id,
          techLevel: system.techLevel,
          planets: system.planets,
          stations: system.stations,
        },
        fittedHullHp: engine.playerLoadout?.hull.hp ?? 0,
        fittedHullTradeIn: engine.playerLoadout
          ? hullTradeInPrice(engine.playerLoadout.hull)
          : 0,
      })
    : { cheapestGearPrice: null, bestHullPrice: null };

  // Only relevant at a craft center; skip the catalog scan otherwise. Matches
  // `executeBuyBestModule`'s precondition so `buy-module` is legal only when the
  // executor could actually buy something (else the autopilot loops on a no-op).
  const affordableModule = hasCraftCenter ? cheapestMicromodule(engine) : null;
  const hasAffordableModule = affordableModule != null;
  // Executor-truth shop spends (see `buyGearCost`/`buyModuleCost`/
  // `upgradeHullCost` docs): the exact credits `buy-gear`/`buy-module`/
  // `upgrade-hull` would move right now.
  const buyGearCost = bestAffordableGear(engine)?.price ?? null;
  const buyModuleCost = affordableModule
    ? micromodulePrice(affordableModule)
    : null;
  const upgradeHullCost = hullUpgradeNetCost(engine);
  const canLiberate = engine.canLiberateCurrentSystem();
  const armUpPlan = planArmUp(engine);
  const armUp = armUpPlan != null;
  // Credits the next arm-up would actually spend (0 when it fields an already
  // owned spare gun for free) — lets the policy keep a trade-capital reserve
  // instead of blowing the whole wallet on a weapon (see `armUpCost` below).
  const armUpCost = armUpPlan?.buyPrice ?? 0;

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: systemSnapshot?.planets.length ?? 0,
    stationCount: systemSnapshot?.stations.length ?? 0,
    hostileCount: hostiles.length,
    connectionCount: systemSnapshot?.connections ?? 0,
    availableQuestCount,
    credits: player.credits,
    cargoUsed,
    hasCraftCenter,
    hasAffordableModule,
    activeLoans: loanStatus.active,
    cheapestGearPrice,
    bestHullPrice,
    canLiberate,
    canArmUp: armUp,
    needsRepair: ship.hullHP < ship.maxHull,
    canAffordRepair: player.credits >= (repairCost(engine) ?? 0),
  }).filter(
    // A DOWNED ship (GOD floor) can neither fire nor hyperjump — the engine
    // blocks all three of these (StarMapScene shows «Корабль повреждён —
    // нужен ремонт”; flee's executor IS a jump), so offering them as "legal"
    // let the policy retry a blocked jump forever (the day-182 capacity
    // wedge). Engine truth, filtered at the single legality source so every
    // policy — heuristic and neural mask alike — inherits it.
    (a) =>
      !playerSnapshot.downed ||
      (a !== "warp" && a !== "attack" && a !== "flee"),
  );

  // Detect a pending hyperjump: the ship is flying to the system edge and a warp
  // will fire when it arrives. Exposing this lets the policy push `wait` instead of
  // re-opening StarMap (which would destroy SpaceFlightScene and cancel the warp).
  const flightScene = engine.currentScene as { pendingWarp?: unknown } | null;
  const warpInTransit =
    scene === SceneType.SPACE_FLIGHT && flightScene?.pendingWarp != null;

  return {
    scene,
    hasPlayer: true,
    player: playerSnapshot,
    system: systemSnapshot,
    currentPlanet,
    npcs,
    hostiles,
    quests,
    legalActions,
    warpInTransit,
    hasBank,
    hasCraftCenter,
    hasRepairDock,
    overmindShare,
    nearOvermindCore,
    overmindHeldHere,
    hostileSystemIds,
    questDeliveryHere,
    activeLoans: loanStatus.active,
    loanBalance: loanStatus.active ? loanStatus.balance : undefined,
    loanMissedPayments: loanStatus.active
      ? loanStatus.missedPayments
      : undefined,
    cheapestGearPrice,
    bestHullPrice,
    canArmUp: armUp,
    armUpCost,
    buyGearCost,
    buyModuleCost,
    upgradeHullCost,
    gameDay: galaxy.gameDays,
    questsCompleted: engine.questManager.getCompletedQuestIds().length,
  };
}
