import { StarType } from "@/types";

/**
 * Weighted star-type distribution for galaxy seeding. Yellow dwarfs stay the
 * commonest sun, but every system now draws from a varied palette so the galaxy
 * is no longer a field of identical yellow suns (the old hardcoded
 * `YELLOW_DWARF`). BLACK_HOLE is excluded — it has no star-map art and reads as
 * an exotic hazard, not a routine sun.
 *
 * Tuned as relative weights (need not sum to 100): the picker normalises by the
 * running total, so future tuning is a one-number edit.
 */
export const STAR_TYPE_WEIGHTS: ReadonlyArray<readonly [StarType, number]> = [
  [StarType.YELLOW_DWARF, 40],
  [StarType.RED_DWARF, 25],
  [StarType.BLUE_GIANT, 15],
  [StarType.WHITE_DWARF, 12],
  [StarType.NEUTRON, 8],
];

/**
 * Equirect star-map art prefix per star type (the `star_maps/<prefix>_NN`
 * family). Single source of truth shared by galaxy seeding (which star types are
 * worth generating) and {@link import("@/presentation/flight/StarRenderer")}'s
 * surface resolution. BLACK_HOLE has no map and is intentionally absent.
 */
export const STAR_MAP_PREFIX: Partial<Record<StarType, string>> = {
  [StarType.RED_DWARF]: "red_dwarf",
  [StarType.YELLOW_DWARF]: "yellow",
  [StarType.BLUE_GIANT]: "blue_giant",
  [StarType.WHITE_DWARF]: "white_dwarf",
  [StarType.NEUTRON]: "neutron",
};

/**
 * Deterministically pick a weighted star type. `rng` only needs `next()` →
 * [0,1) (a {@link import("@/utils/seededRNG").SeededRNG} satisfies this), so the
 * draw is reproducible from the seed it was built with.
 */
export function pickStarType(rng: { next(): number }): StarType {
  const total = STAR_TYPE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of STAR_TYPE_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return STAR_TYPE_WEIGHTS[0][0];
}
