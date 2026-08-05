import { StarType } from "@/types";

export const STAR_TYPE_WEIGHTS: ReadonlyArray<readonly [StarType, number]> = [
  [StarType.YELLOW_DWARF, 40],
  [StarType.RED_DWARF, 25],
  [StarType.BLUE_GIANT, 15],
  [StarType.WHITE_DWARF, 12],
  [StarType.NEUTRON, 8],
];

export const STAR_MAP_PREFIX: Partial<Record<StarType, string>> = {
  [StarType.RED_DWARF]: "red_dwarf",
  [StarType.YELLOW_DWARF]: "yellow",
  [StarType.BLUE_GIANT]: "blue_giant",
  [StarType.WHITE_DWARF]: "white_dwarf",
  [StarType.NEUTRON]: "neutron",
};

export function pickStarType(rng: { next(): number }): StarType {
  const total = STAR_TYPE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [type, weight] of STAR_TYPE_WEIGHTS) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return STAR_TYPE_WEIGHTS[0][0];
}
