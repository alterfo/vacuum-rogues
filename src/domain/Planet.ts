import type { FactionType, PlanetType } from "@/types";
import type { Market } from "./Market";
import type { NPC } from "./NPC";
import type { Quest } from "./Quest";

export class Planet {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: PlanetType,
    public readonly orbitalRadius: number,
    public readonly market: Market,
    public readonly inhabitants: NPC[],
    public readonly availableQuests: Quest[],
    public readonly isHabitable: boolean = true,
    public drones: number = 0,
    public population: number = 0,
    public capturedBy: FactionType | null = null,
  ) {}
}
