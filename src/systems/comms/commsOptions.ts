import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import type { NpcShip } from "@/domain/NpcShip";
import type { SeededRNG } from "@/utils/seededRNG";

export type CommsContext =
  | "pirate-shakedown" // a hostile pirate demanding tribute ("кошелёк или жизнь")
  | "neutral" // a non-hostile ship: trade / hire / ally
  | "hostile-other" // a hostile non-pirate (garrison, provoked ship): fight or flee
  | "overmind"; // Predecessor/Overmind craft: only gibberish, no real options

export type CommsOption =
  | "trade"
  | "hire"
  | "ally"
  | "attack"
  | "pay-tribute"
  | "flee";

export function commsContextFor(npc: NpcShip): CommsContext {
  if (npc.faction === Faction.OVERMIND) return "overmind";
  if (npc.isAggressive()) {
    return npc.role === NpcRole.PIRATE ? "pirate-shakedown" : "hostile-other";
  }
  return "neutral";
}

export function commsOptionsFor(
  npc: NpcShip,
  context: CommsContext = commsContextFor(npc),
): CommsOption[] {
  switch (context) {
    case "pirate-shakedown":
      return ["pay-tribute", "attack", "flee"];
    case "neutral":
      return ["trade", "hire", "ally", "attack"];
    case "hostile-other":
      return ["attack", "flee"];
    case "overmind":
      return [];
  }
}

const OVERMIND_GIBBERISH: readonly string[] = [
  "◊≈∴⟆ ⟁⟆∴ ◊≋⟆… ⟆∴◊⟁ ≈⟆∴ ҂҂҂",
  "ZRR͞T… kx'thūl ҂ veshk —— nnnghrr",
  "…⟁∴≋◊⟆∴ ⟆⟁∴◊ ≈≈≈ ⟆∴⟁◊≋ ψ҂ʘ",
  "grSHK-grSHK… ψ҂ʘ ⟆∴◊⟁⟆ ҂ψ ◊◊",
];

export function overmindGibberish(rng: SeededRNG): string {
  const i = rng.nextInt(0, OVERMIND_GIBBERISH.length - 1);
  return OVERMIND_GIBBERISH[i] ?? OVERMIND_GIBBERISH[0];
}
