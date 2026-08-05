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

export interface ShipLocation {
  readonly id: string;
  readonly name: string;
  readonly role: NpcRole;
  readonly faction: Faction;
  readonly systemId: string;
}

export interface MarketListing {
  readonly systemId: string;
  readonly planetId: string;
  readonly resource: ResourceType;
  readonly price: number;
}

export interface ResourceHit extends MarketListing {
  readonly jumps: number;
}

export interface ResourceQuery {
  readonly resource: ResourceType;
  readonly originSystemId: string;
  readonly maxJumps?: number;
  readonly sort?: "price" | "jumps";
  readonly limit?: number;
}

export interface ShipQuery {
  readonly originSystemId: string;
  readonly role?: NpcRole;
  readonly faction?: Faction;
  readonly maxJumps?: number;
  readonly name?: string;
}

export interface PlanetHit {
  readonly systemId: string;
  readonly planetId: string;
  readonly planetName: string;
  readonly systemName: string;
  readonly jumps: number;
}

export interface PlanetQuery {
  readonly name: string;
  readonly originSystemId: string;
  readonly maxJumps?: number;
}

export interface SystemHit {
  readonly systemId: string;
  readonly systemName: string;
  readonly jumps: number;
}

export interface SystemQuery {
  readonly name: string;
  readonly originSystemId: string;
  readonly maxJumps?: number;
}

export interface GearListing {
  readonly systemId: string;
  readonly planetId: string;
  readonly gear: Gear;
  readonly price: number;
}

export interface GearHit extends GearListing {
  readonly jumps: number;
}

export interface GearQuery {
  readonly originSystemId: string;
  readonly kind?: GearKind;
  readonly minTech?: number;
  readonly maxTech?: number;
  readonly maxSize?: number;
  readonly maxPrice?: number;
  readonly maxJumps?: number;
  readonly minHp?: number;
  readonly minSlots?: number;
  readonly minCargo?: number;
  readonly minDamage?: number;
  readonly minRange?: number;
  readonly sort?: "price" | "jumps" | "damage" | "hp" | "tech";
  readonly limit?: number;
}

export type EquipmentFacet =
  | "engine"
  | "hull"
  | "weapon"
  | "scanner"
  | "shield"
  | "other";

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
  readonly types?: EquipmentFacet[];
  readonly name?: string;
  readonly maxPrice?: number;
  readonly maxJumps?: number;
}

export class GalacticRegistry {
  private readonly systems: StarSystem[];
  private readonly shipById = new Map<string, ShipLocation>();
  private readonly shipsBySystem = new Map<string, ShipLocation[]>();
  private readonly listings: MarketListing[] = [];
  private readonly gearListings: GearListing[];
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

  findShip(id: string): ShipLocation | null {
    return this.shipById.get(id) ?? null;
  }

  shipsInSystem(systemId: string): ShipLocation[] {
    return this.shipsBySystem.get(systemId) ?? [];
  }

  findShips(query: ShipQuery): (ShipLocation & { jumps: number })[] {
    const dist = jumpDistances(this.systems, query.originSystemId, {
      undirected: true,
    });
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

  findPlanet(query: PlanetQuery): PlanetHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId, {
      undirected: true,
    });
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

  findSystem(query: SystemQuery): SystemHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId, {
      undirected: true,
    });
    const nameLower = query.name.toLowerCase();
    const out: SystemHit[] = [];
    for (const sys of this.systems) {
      if (!sys.name.toLowerCase().includes(nameLower)) continue;
      const jumps = dist.get(sys.id);
      if (jumps === undefined) continue; // unreachable from origin
      if (query.maxJumps !== undefined && jumps > query.maxJumps) continue;
      out.push({ systemId: sys.id, systemName: sys.name, jumps });
    }
    out.sort(
      (a, b) => a.jumps - b.jumps || a.systemName.localeCompare(b.systemName),
    );
    return out;
  }

  findResource(query: ResourceQuery): ResourceHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId, {
      undirected: true,
    });
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

  cheapestResource(query: ResourceQuery): ResourceHit | null {
    return this.findResource({ ...query, sort: "price" })[0] ?? null;
  }

  findGear(query: GearQuery): GearHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId, {
      undirected: true,
    });
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

  bestGear(query: GearQuery): GearHit | null {
    return this.findGear(query)[0] ?? null;
  }

  findEquipment(query: EquipmentQuery): EquipmentHit[] {
    const dist = jumpDistances(this.systems, query.originSystemId, {
      undirected: true,
    });
    const systemMap = new Map<string, StarSystem>(
      this.systems.map((s) => [s.id, s]),
    );
    const hits: EquipmentHit[] = [];
    for (const l of this.gearListings) {
      if (
        !matchesFacet(
          l.gear,
          query.types ?? (query.type !== undefined ? [query.type] : undefined),
        )
      )
        continue;
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

  get listingCount(): number {
    return this.listings.length;
  }

  get gearListingCount(): number {
    return this.gearListings.length;
  }
}

function matchesFacet(g: Gear, facets: EquipmentFacet[] | undefined): boolean {
  if (facets === undefined || facets.length === 0) return true;
  return facets.some((facet) => matchesSingleFacet(g, facet));
}

function matchesSingleFacet(g: Gear, facet: EquipmentFacet): boolean {
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
