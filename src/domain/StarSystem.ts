import type {
  AxialCoord,
  StarType,
  EconomyType,
  PoliticalSystem,
} from "@/types";
import { Faction } from "@/types/faction";
import type { Planet } from "./Planet";
import type { WarpPath } from "./WarpPath";
import type { Station } from "./Station";

export class StarSystem {
  explored = false;
  fogOfWar = true;
  lastVisitedDay?: number = undefined;
  /** True when this system is the home system of one of the 5 major factions. */
  isFactionHome: boolean = false;
  /** Faction that considers this their home system (null for regular systems). */
  homeFactionId: Faction | null = null;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly coordinates: AxialCoord,
    public readonly starType: StarType,
    public readonly planets: Planet[],
    public readonly ownerFaction: Faction,
    public readonly connections: WarpPath[],
    public readonly stations: Station[] = [],
    public readonly economyType: EconomyType = "MIXED" as EconomyType,
    public readonly politicalSystem: PoliticalSystem = "REPUBLIC" as PoliticalSystem,
  ) {}

  enter(_player: unknown): void {
    this.explored = true;
    this.fogOfWar = false;
  }
}
