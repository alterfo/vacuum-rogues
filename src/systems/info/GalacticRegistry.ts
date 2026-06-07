/**
 * Galactic information registry (EPIC-009, US-090/091/092/093/094).
 *
 * A derived, query-friendly index over the galaxy: where each significant ship
 * is, and what each planet's market sells and at what price. It answers the
 * "who/what/where" questions the in-game info center surfaces — including
 * parameter-style searches ranked by price or by hyperjump distance from the
 * player's current system.
 *
 * Pure logic: no PixiJS / DOM. It indexes existing domain state (it does not own
 * or mutate it); rebuild (or construct anew) after the simulation advances.
 * Gear/weapon/hull search (EPIC-007 catalog) plugs in here once that data
 * model exists; for now market goods are the searchable inventory.
 */
import type { StarSystem } from "@/domain/StarSystem";
import type { NpcShip } from "@/domain/NpcShip";
import type { ResourceType, NpcRole, NewsEvent } from "@/types";
import type { Faction } from "@/types/faction";
import { jumpDistances } from "@/systems/galaxy/jumpDistance";
import {
  GearKind,
  EquipmentClass,
  type Gear,
  type HullSpec,
  type WeaponSpec,
  type EquipmentSpec,
} from "@/systems/equipment/GearCatalog";

/** Where a ship is right now (US-091). */
export interface ShipLocation {
  readonly id: string;
  readonly name: string;
  readonly role: NpcRole;
  readonly faction: Faction;
  readonly systemId: string;
}

/** A single market listing for a resource (US-092). */
export interface MarketListing {
  readonly systemId: string;
  readonly planetId: string;
  readonly resource: ResourceType;
  readonly price: number;
}

/** A search hit with the hyperjump distance from the query origin (US-094). */
export interface ResourceHit extends MarketListing {
  readonly jumps: number;
}

export interface ResourceQuery {
  readonly resource: ResourceType;
  /** System the player is in (for jump-distance ranking). */
  readonly originSystemId: string;
  /** Drop results farther than this many jumps (omit = no limit). */
  readonly maxJumps?: number;
  /** Rank by cheapest price (default) or by nearest in jumps. */
  readonly sort?: "price" | "jumps";
  /** Cap the number of results (omit = all). */
  readonly limit?: number;
}

export interface ShipQuery {
  readonly originSystemId: string;
  readonly role?: NpcRole;
  readonly faction?: Faction;
  readonly maxJumps?: number;
  /** Case-insensitive substring filter on ship name. */
  readonly name?: string;
}

/** A planet location result for the "Объекты" info-center tab. */
export interface PlanetHit {
  readonly systemId: string;
  readonly planetId: string;
  readonly planetName: string;
  readonly systemName: string;
  readonly jumps: number;
}

export interface PlanetQuery {
  /** Case-insensitive substring to match against planet names. */
  readonly name: string;
  readonly originSystemId: string;
  readonly maxJumps?: number;
}

/** A piece of gear for sale somewhere (US-092, gear half). */
export interface GearListing {
  readonly systemId: string;
  readonly planetId: string;
  readonly gear: Gear;
  readonly price: number;
}

/** A gear search hit annotated with hyperjump distance (US-093/094). */
export interface GearHit extends GearListing {
  readonly jumps: number;
}

/** Parameter search over gear (US-093): "best hull/weapon for criterion X". */
export interface GearQuery {
  readonly originSystemId: string;
  readonly kind?: GearKind;
  readonly minTech?: number;
  readonly maxTech?: number;
  readonly maxSize?: number;
  readonly maxPrice?: number;
  readonly maxJumps?: number;
  // Hull criteria
  readonly minHp?: number;
  readonly minSlots?: number;
  readonly minCargo?: number;
  // Weapon criteria
  readonly minDamage?: number;
  readonly minRange?: number;
  readonly sort?: "price" | "jumps" | "damage" | "hp" | "tech";
  readonly limit?: number;
}

/** Faceted equipment filter type for the InfoCenter gear tab. */
export type EquipmentFacet =
  | "engine"
  | "hull"
  | "weapon"
  | "scanner"
  | "shield"
  | "other";

/** Equipment search hit with resolved planet/system names. */
export interface EquipmentHit {
  readonly gear: Gear;
  readonly planet: string;
  readonly system: string;
  readonly price: number;
  readonly jumps: number;
  readonly systemId: string;
  readonly planetId: string;
}

export interface EquipmentQuery {
  readonly originSystemId: string;
  readonly type?: EquipmentFacet;
  readonly name?: string;
  readonly maxPrice?: number;
  readonly maxJumps?: number;
}

export class GalacticRegistry {
  private readonly systems: StarSystem[];
  private readonly shipById = new Map<string, ShipLocation>();
  private readonly shipsBySystem = new Map<string, ShipLocation[]>();
  /** Flat list of every (planet, resource, price) the markets offer. */
  private readonly listings: MarketListing[] = [];
  /** Gear for sale across the galaxy (from the shop generator). */
  private readonly gearListings: GearListing[];
  /** Living-galaxy simulation events (news feed), newest last. */
  readonly newsFeed: NewsEvent[];

  constructor(
    systems: StarSystem[],
    ships: NpcShip[],
    gearListings: GearListing[] = [],
    newsFeed: NewsEvent[] = [],
  ) {
    this.systems = systems;
    this.gearListings = gearListings;
    this.newsFeed = newsFeed;
    this.indexShips(ships);
    this.indexMarkets();
  }

  private indexShips(ships: NpcShip[]): void {
    for (const s of ships) {
      const loc: ShipLocation = {
        id: s.id,
        name: s.name,
        role: s.role,
        faction: s.faction,
        systemId: s.currentSystemId,
      };
      this.shipById.set(s.id, loc);
      const bucket = this.shipsBySystem.get(loc.systemId);
      if (bucket) bucket.push(loc);
      else this.shipsBySystem.set(loc.systemId, [loc]);
    }
  }

  private indexMarkets(): void {
    for (const sys of this.systems) {
      for (const planet of sys.planets) {
        const market = planet.market;
        if (!market) continue;
        for (const resource of market.availableResources) {
          const price = market.getPrice(resource);
          if (price <= 0) continue;
          this.listings.push({
            systemId: sys.id,
            planetId: planet.id,
            resource,
            price,
          });
        }
      }
    }
  }

  // --- Ship location queries (US-091) -------------------------------------

  /** Where is this ship now, or null if it isn't tracked. */
  findShip(id: string): ShipLocation | null {
    return this.shipById.get(id) ?? null;
  }

  /** Ships currently in a given system. */
  shipsInSystem(systemId: string): ShipLocation[] {
    return this.shipsBySystem.get(systemId) ?? [];
  }

  /** Ships matching role/faction/name, within an optional jump radius, nearest first. */
  findShips(query: ShipQuery): (ShipLocation & { jumps: number })[] {
    const dist = jumpDistances(this.systems, query.originSystemId);
    const nameLower = query.name?.toLowerCase();
    const out: (ShipLocation & { jumps: number })[] = [];
    for (const loc of this.shipById.values()) {
      if (query.role !== undefined && loc.role !== query.role) continue;
      if (query.faction !== undefined && loc.faction !== query.faction)
        continue;
      if (nameLower && !loc.name.toLowerCase().includes(nameLower)) continue;
      const jumps = dist.get(loc.systemId);
      if (jumps === undefined) continue; // unreachable from origin
      if (query.maxJumps !== undefined && jumps > query.maxJumps) continue;
      out.push({ ...loc, jumps });
    }
    out.sort((a, b) => a.jumps - b.jumps || a.id.localeCompare(b.id));
    return out;
  }

  /** Find planets by (partial, case-insensitive) name match, nearest first. */
  findPlanet(query: PlanetQuery): PlanetHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId);
    const nameLower = query.name.toLowerCase();
    const out: PlanetHit[] = [];
    for (const sys of this.systems) {
      const jumps = dist.get(sys.id);
      if (jumps === undefined) continue;
      if (query.maxJumps !== undefined && jumps > query.maxJumps) continue;
      for (const planet of sys.planets) {
        const pName =
          (planet as unknown as { name?: string }).name ?? planet.id;
        if (!pName.toLowerCase().includes(nameLower)) continue;
        out.push({
          systemId: sys.id,
          planetId: planet.id,
          planetName: pName,
          systemName: sys.name,
          jumps,
        });
      }
    }
    out.sort(
      (a, b) => a.jumps - b.jumps || a.planetName.localeCompare(b.planetName),
    );
    return out;
  }

  // --- Market / resource queries (US-092/093/094) -------------------------

  /**
   * Find where a resource is sold, ranked by price (default) or distance, each
   * hit annotated with hyperjumps from the query origin. This is the "where can
   * I buy X best / cheapest, and how far is it" lookup (US-094).
   */
  findResource(query: ResourceQuery): ResourceHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId);
    const hits: ResourceHit[] = [];
    for (const l of this.listings) {
      if (l.resource !== query.resource) continue;
      const jumps = dist.get(l.systemId);
      if (jumps === undefined) continue;
      if (query.maxJumps !== undefined && jumps > query.maxJumps) continue;
      hits.push({ ...l, jumps });
    }
    const sort = query.sort ?? "price";
    hits.sort((a, b) =>
      sort === "jumps"
        ? a.jumps - b.jumps || a.price - b.price
        : a.price - b.price || a.jumps - b.jumps,
    );
    return query.limit !== undefined ? hits.slice(0, query.limit) : hits;
  }

  /** The single cheapest place to buy a resource within range, or null. */
  cheapestResource(query: ResourceQuery): ResourceHit | null {
    return this.findResource({ ...query, sort: "price" })[0] ?? null;
  }

  // --- Gear parameter search (US-093/094, "buy the best hull/weapon") ------

  /**
   * Search gear for sale by parameters (kind, tech, size, price, and
   * kind-specific minima like hull HP/slots or weapon damage/range), each hit
   * annotated with hyperjumps from the origin. Answers "where can I buy the best
   * hull/weapon meeting criterion X, and how far is it" (US-094).
   */
  findGear(query: GearQuery): GearHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId);
    const hits: GearHit[] = [];
    for (const l of this.gearListings) {
      const g = l.gear;
      if (query.kind !== undefined && g.kind !== query.kind) continue;
      if (query.minTech !== undefined && g.techLevel < query.minTech) continue;
      if (query.maxTech !== undefined && g.techLevel > query.maxTech) continue;
      if (query.maxSize !== undefined && g.size > query.maxSize) continue;
      if (query.maxPrice !== undefined && l.price > query.maxPrice) continue;
      if (!matchesHull(g, query)) continue;
      if (!matchesWeapon(g, query)) continue;
      const jumps = dist.get(l.systemId);
      if (jumps === undefined) continue;
      if (query.maxJumps !== undefined && jumps > query.maxJumps) continue;
      hits.push({ ...l, jumps });
    }
    sortGear(hits, query.sort ?? "price");
    return query.limit !== undefined ? hits.slice(0, query.limit) : hits;
  }

  /** Best single gear match for a criterion (default cheapest), or null. */
  bestGear(query: GearQuery): GearHit | null {
    return this.findGear(query)[0] ?? null;
  }

  // --- Faceted equipment search (US-093, InfoCenter tab) --------------------

  /**
   * Equipment search by human-friendly facet type with resolved planet/system
   * names. Used by the InfoCenter gear tab faceted filter.
   */
  findEquipment(query: EquipmentQuery): EquipmentHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId);
    const systemMap = new Map<string, StarSystem>(
      this.systems.map((s) => [s.id, s]),
    );
    const hits: EquipmentHit[] = [];
    for (const l of this.gearListings) {
      if (!matchesFacet(l.gear, query.type)) continue;
      if (query.maxPrice !== undefined && l.price > query.maxPrice) continue;
      if (
        query.name !== undefined &&
        query.name.length > 0 &&
        !l.gear.name.toLowerCase().includes(query.name.toLowerCase())
      )
        continue;
      const jumps = dist.get(l.systemId);
      if (jumps === undefined) continue;
      if (query.maxJumps !== undefined && jumps > query.maxJumps) continue;
      const sys = systemMap.get(l.systemId);
      const systemName = sys?.name ?? l.systemId;
      let planetName = l.planetId;
      if (sys) {
        for (const p of sys.planets) {
          if (p.id === l.planetId) {
            planetName = (p as unknown as { name?: string }).name ?? p.id;
            break;
          }
        }
      }
      hits.push({
        gear: l.gear,
        planet: planetName,
        system: systemName,
        price: l.price,
        jumps,
        systemId: l.systemId,
        planetId: l.planetId,
      });
    }
    hits.sort((a, b) => a.price - b.price || a.jumps - b.jumps);
    return hits;
  }

  /** Total market listings indexed (diagnostics/tests). */
  get listingCount(): number {
    return this.listings.length;
  }

  /** Total gear listings indexed (diagnostics/tests). */
  get gearListingCount(): number {
    return this.gearListings.length;
  }
}

function matchesFacet(g: Gear, facet: EquipmentFacet | undefined): boolean {
  if (facet === undefined) return true;
  switch (facet) {
    case "hull":
      return g.kind === GearKind.HULL;
    case "weapon":
      return g.kind === GearKind.WEAPON;
    case "engine":
      return (
        g.kind === GearKind.EQUIPMENT &&
        (g as EquipmentSpec).equipmentClass === EquipmentClass.ENGINE
      );
    case "scanner":
      return (
        g.kind === GearKind.EQUIPMENT &&
        (g as EquipmentSpec).equipmentClass === EquipmentClass.SCANNER
      );
    case "shield":
      return (
        g.kind === GearKind.EQUIPMENT &&
        (g as EquipmentSpec).equipmentClass === EquipmentClass.SHIELD
      );
    case "other":
      return (
        g.kind === GearKind.EQUIPMENT &&
        (g as EquipmentSpec).equipmentClass !== EquipmentClass.ENGINE &&
        (g as EquipmentSpec).equipmentClass !== EquipmentClass.SCANNER &&
        (g as EquipmentSpec).equipmentClass !== EquipmentClass.SHIELD
      );
    default:
      return true;
  }
}

function matchesHull(g: Gear, q: GearQuery): boolean {
  const wantsHull =
    q.minHp !== undefined ||
    q.minSlots !== undefined ||
    q.minCargo !== undefined;
  if (!wantsHull) return true;
  if (g.kind !== GearKind.HULL) return false;
  const h = g as HullSpec;
  if (q.minHp !== undefined && h.hp < q.minHp) return false;
  if (q.minSlots !== undefined && h.slots < q.minSlots) return false;
  if (q.minCargo !== undefined && h.cargo < q.minCargo) return false;
  return true;
}

function matchesWeapon(g: Gear, q: GearQuery): boolean {
  const wantsWeapon = q.minDamage !== undefined || q.minRange !== undefined;
  if (!wantsWeapon) return true;
  if (g.kind !== GearKind.WEAPON) return false;
  const w = g as WeaponSpec;
  if (q.minDamage !== undefined && w.damage < q.minDamage) return false;
  if (q.minRange !== undefined && w.range < q.minRange) return false;
  return true;
}

function sortGear(hits: GearHit[], sort: NonNullable<GearQuery["sort"]>): void {
  const dmg = (h: GearHit) =>
    h.gear.kind === GearKind.WEAPON ? (h.gear as WeaponSpec).damage : 0;
  const hp = (h: GearHit) =>
    h.gear.kind === GearKind.HULL ? (h.gear as HullSpec).hp : 0;
  hits.sort((a, b) => {
    switch (sort) {
      case "jumps":
        return a.jumps - b.jumps || a.price - b.price;
      case "damage":
        return dmg(b) - dmg(a) || a.price - b.price;
      case "hp":
        return hp(b) - hp(a) || a.price - b.price;
      case "tech":
        return b.gear.techLevel - a.gear.techLevel || a.price - b.price;
      case "price":
      default:
        return a.price - b.price || a.jumps - b.jumps;
    }
  });
}
