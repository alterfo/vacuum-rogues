import type { StationType } from "@/types";
import type { Faction } from "@/types/faction";

/**
 * A space station: a fixed point in a star system offering type-specific
 * services. Positioned at a fixed orbital radius and angle (no orbit drift).
 */
export class Station {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: StationType,
    public readonly faction: Faction,
    /** World-space distance from star centre (px). */
    public readonly orbitRadius: number,
    /** Fixed angle in radians (0 = right, clockwise). */
    public readonly orbitAngle: number,
  ) {}
}
