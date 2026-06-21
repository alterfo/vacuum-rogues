import { NpcRole } from "@/types";
import { Faction } from "@/types/faction";
import type { NpcShip } from "@/domain/NpcShip";
import type { SeededRNG } from "@/utils/seededRNG";

/**
 * Conversational context a comms hail opens in ("Universal Comms Window" —
 * `docs/plans/20260619-universal-comms-and-pirate-encounters.md`). One window,
 * many contexts: the option set is a pure function of the ship + situation, so
 * the panel is a thin renderer over {@link commsOptionsFor}.
 */
export type CommsContext =
  | "pirate-shakedown" // a hostile pirate demanding tribute ("кошелёк или жизнь")
  | "neutral" // a non-hostile ship: trade / hire / ally
  | "hostile-other" // a hostile non-pirate (garrison, provoked ship): fight or flee
  | "overmind"; // Predecessor/Overmind craft: only gibberish, no real options

/** A single actionable comms choice surfaced to the player. */
export type CommsOption =
  | "trade"
  | "hire"
  | "ally"
  | "attack"
  | "pay-tribute"
  | "flee";

/**
 * Classify which comms context a hail with this NPC opens in. Pure — derived
 * from faction / role / hostility only.
 *
 * - Overmind (Предтечи) ships always answer with gibberish, regardless of state.
 * - An openly hostile pirate is shaking the player down ("кошелёк или жизнь").
 * - Any other hostile ship is just a fight to win or flee.
 * - Everyone else is neutral: trade, hire, or ally.
 */
export function commsContextFor(npc: NpcShip): CommsContext {
  if (npc.faction === Faction.OVERMIND) return "overmind";
  if (npc.isAggressive()) {
    return npc.role === NpcRole.PIRATE ? "pirate-shakedown" : "hostile-other";
  }
  return "neutral";
}

/**
 * The available comms options for a hail, by context. Pure function of ship +
 * context so it is fully unit-testable and the panel just renders the result.
 *
 * - pirate-shakedown → pay tribute, fight, or flee
 * - neutral          → trade, hire, ally, or attack
 * - hostile-other    → fight or flee
 * - overmind         → none (only gibberish — Task 5)
 *
 * The `npc` argument is currently only used to default the context, but is kept
 * in the signature so future refinements (role-gated trade, strength-gated
 * shakedown) can read ship stats without a call-site change.
 */
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

// ---------------------------------------------------------------------------
// Overmind gibberish (Task 5) — hailing a Предтечи craft is futile: it answers
// with nonsense and exposes no actionable options (commsOptionsFor → []).
// ---------------------------------------------------------------------------

/**
 * Nonsense "transmission" fragments an Overmind ("Предтечи") craft emits instead
 * of speech. Deliberately unpronounceable so the hail reads as alien static.
 */
const OVERMIND_GIBBERISH: readonly string[] = [
  "◊≈∴⟆ ⟁⟆∴ ◊≋⟆… ⟆∴◊⟁ ≈⟆∴ ҂҂҂",
  "ZRR͞T… kx'thūl ҂ veshk —— nnnghrr",
  "…⟁∴≋◊⟆∴ ⟆⟁∴◊ ≈≈≈ ⟆∴⟁◊≋ ψ҂ʘ",
  "grSHK-grSHK… ψ҂ʘ ⟆∴◊⟁⟆ ҂ψ ◊◊",
];

/**
 * A single gibberish hail line an Overmind craft answers with. The Overmind
 * never speaks intelligibly, which is why {@link commsOptionsFor} returns `[]`
 * for the `overmind` context — there is nothing actionable to surface. Pure:
 * picks a fragment via the seeded RNG so callers (and tests) are deterministic,
 * and always returns a non-empty fragment.
 */
export function overmindGibberish(rng: SeededRNG): string {
  const i = rng.nextInt(0, OVERMIND_GIBBERISH.length - 1);
  return OVERMIND_GIBBERISH[i] ?? OVERMIND_GIBBERISH[0];
}
