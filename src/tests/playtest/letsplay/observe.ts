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
import { SceneType } from "@/types";
import type {
  ResourceType,
  QuestType,
  FactionType,
  StationType,
} from "@/types";
import { npcsPresentInSystem } from "@/systems/npc/NpcSimulator";
import { cargoCapacityOf } from "@/systems/equipment/GearBridge";
import { TradeSystem } from "@/systems/TradeSystem";
import type { Planet } from "@/domain/Planet";
import type { Player } from "@/domain/Player";

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
  | "wait"; // pass / advance a frame

/**
 * Canonical action order so two equal states yield identical `legalActions`.
 * Also the fixed **action vocabulary** a neural policy's output head indexes into
 * (`NeuralPolicy` maps `scores[i]` → `ACTION_ORDER[i]`), so the ordering is a
 * single source of truth shared by the legal-action surface and the net seam.
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
];

/** Player vitals + cargo + world position. */
export interface PlayerSnapshot {
  credits: number;
  hull: number;
  maxHull: number;
  /** `hull / maxHull` in `[0, 1]` (0 when `maxHull` is 0). */
  hullFraction: number;
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
}

/** The player's current star system + what's reachable from it. */
export interface SystemSnapshot {
  id: string;
  name: string;
  planets: { id: string; name: string; availableQuests: number }[];
  stations: { id: string; name: string; type: StationType }[];
  /** Number of warp paths leading out of this system. */
  connections: number;
}

/** A single NPC ship present (not in transit) in the player's system. */
export interface NpcSnapshot {
  id: string;
  name: string;
  faction: FactionType;
  hostile: boolean;
  hullHP: number;
}

/** An active contract the player is carrying. */
export interface QuestSnapshot {
  id: string;
  title: string;
  type: QuestType;
  targetSystemId: string | null;
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
      break;
    }
    case SceneType.PLANET: {
      // A landed ship can shop the planet market, take offered work or take off.
      set.add("trade");
      set.add("move");
      set.add("wait");
      if (ctx.availableQuestCount > 0) set.add("take-quest");
      break;
    }
    case SceneType.TRADE: {
      set.add("trade");
      set.add("move");
      set.add("wait");
      break;
    }
    case SceneType.STATION: {
      // Off-planet bases repair/refit; leaving returns to flight.
      set.add("repair");
      set.add("move");
      set.add("wait");
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
      // Dialogue / inventory / equipment / government / info / text-quest / bank:
      // sub-screens the agent can read and back out of.
      set.add("move");
      set.add("wait");
      break;
    }
  }

  return ACTION_ORDER.filter((a) => set.has(a));
}

/**
 * Egocentric market read: the buy/sell price for every good the *landed* planet
 * trades, priced for this player. Only ever called for the planet the player is
 * standing on, so an unvisited planet's prices are never produced. Order follows
 * the market's `availableResources` so two reads of one state are deep-equal.
 */
function marketSnapshotFor(
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
 * Project the live engine into an {@link Observation}. Read-only and total — a
 * partially-initialised engine (e.g. on the main menu, before a game) yields
 * `hasPlayer: false` with a `["wait"]` action set rather than throwing.
 */
export function observe(engine: GameEngine): Observation {
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
    fuel: ship.energy,
    maxFuel: ship.maxEnergy,
    fuelFraction: ship.maxEnergy > 0 ? ship.energy / ship.maxEnergy : 0,
    cargo,
    cargoUsed,
    cargoCapacity,
    systemId: player.currentSystemId,
    position: flightPos ? { x: flightPos.x, y: flightPos.y } : null,
  };

  const system =
    galaxy.systems.find((s) => s.id === player.currentSystemId) ?? null;

  const systemSnapshot: SystemSnapshot | null = system
    ? {
        id: system.id,
        name: system.name,
        planets: system.planets.map((p) => ({
          id: p.id,
          name: p.name,
          availableQuests: p.availableQuests.length,
        })),
        stations: system.stations.map((st) => ({
          id: st.id,
          name: st.name,
          type: st.type,
        })),
        connections: system.connections.length,
      }
    : null;

  const npcs: NpcSnapshot[] = system
    ? npcsPresentInSystem(galaxy, system.id).map((n) => ({
        id: n.id,
        name: n.name,
        faction: n.race,
        hostile: n.hostile,
        hullHP: n.hullHP,
      }))
    : [];
  const hostiles = npcs.filter((n) => n.hostile);

  const quests: QuestSnapshot[] = engine.questManager
    .getActiveQuests()
    .map((q) => ({
      id: q.id,
      title: q.title,
      type: q.type,
      targetSystemId: q.targetSystemId ?? null,
    }));

  // The landed planet (PLANET scene), used to gate "take-quest".
  const landed =
    player.landedPlanetId && system
      ? (system.planets.find((p) => p.id === player.landedPlanetId) ?? null)
      : null;
  const currentPlanet: CurrentPlanetSnapshot | null = landed
    ? {
        id: landed.id,
        name: landed.name,
        availableQuests: landed.availableQuests.length,
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

  const legalActions = legalActionsForScene(scene, {
    hasPlayer: true,
    planetCount: systemSnapshot?.planets.length ?? 0,
    stationCount: systemSnapshot?.stations.length ?? 0,
    hostileCount: hostiles.length,
    connectionCount: systemSnapshot?.connections ?? 0,
    availableQuestCount,
  });

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
  };
}
