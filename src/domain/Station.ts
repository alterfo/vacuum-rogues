import type { StationType } from "@/types";
import type { Faction } from "@/types/faction";

export class Station {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: StationType,
    public readonly faction: Faction,
    public readonly orbitRadius: number,
    public readonly orbitAngle: number,
  ) {}
}
