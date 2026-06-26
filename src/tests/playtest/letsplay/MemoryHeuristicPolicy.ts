/**
 * Letsplay engine — the memory-using heuristic (the BC teacher, dev-only).
 *
 * A {@link PlayerPolicy} that plays like a human by reasoning over its **belief
 * state** ({@link AgentMemory}) instead of only the egocentric {@link Observation}.
 * Where {@link HeuristicPolicy} is memoryless — it trades blindly on whatever
 * planet it happens to be on — this policy carries what it has *seen* across steps
 * and uses it for multi-step, goal-sequenced play:
 *
 *  - **buy low + remember.** Standing on the planet its price book says is the
 *    cheapest source for a good it can resell elsewhere at a profit ⇒ `trade` to
 *    buy (recorded with a buy-price lot the moment cargo grows).
 *  - **sell where the margin is best.** Holding cargo that `profitIfSoldHere` says
 *    is worth more than it paid ⇒ `trade` to sell; in flight it *returns* to the
 *    remembered sell planet (`land`, targeting it) to realise the known margin —
 *    the behaviour the memoryless baseline cannot produce.
 *  - **save toward a known upgrade.** A known offer it cannot yet afford is
 *    **deferred** (it keeps earning); once affordable it routes to the offer's
 *    location to go get it.
 *  - **avoid known-dangerous systems.** When the system it is working toward is
 *    remembered as dangerous, it does not push deeper while hurt — it finishes a
 *    local trade / heads to repair first rather than warping into the threat.
 *
 * Every decision is filtered through `obs.legalActions` (and `"wait"` is always
 * legal), so — exactly like the baseline — it can **never** return an illegal
 * action and never throws. The core {@link decideWithMemory} is **pure**: the same
 * `(obs, memory)` always yields the same action, which is what makes it a clean
 * behavioural-cloning teacher and lets the scripted A/B/C scenario be unit-tested
 * in isolation. The {@link MemoryHeuristicPolicy} class is a thin stateful adapter
 * that folds each observation into a per-run notebook so it is also a drop-in
 * {@link PlayerPolicy} for the agent loop. Lives under `src/tests/` and is dev-only.
 */
import { SceneType } from "@/types";
import type { ResourceType } from "@/types";
import type { Observation, PlayerActionKind } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";
import { LOW_HULL_FRACTION } from "./HeuristicPolicy";
import { type AgentMemory, createMemory, updateMemory } from "./AgentMemory";
import {
  bestKnownMargin,
  cheapestKnownOffer,
  profitIfSoldHere,
  routeDangerToGoal,
} from "./memoryFeatures";

/**
 * Above this hull fraction the agent treats itself as "battle-ready" — below it,
 * a remembered-dangerous goal makes it earn / repair before pressing on rather
 * than warping into the threat.
 */
export const BATTLE_READY_HULL_FRACTION = 0.99;

/** One ranked action candidate: a legal-or-not preference the legal filter prunes. */
interface Candidate {
  kind: PlayerActionKind;
  targetId?: string;
  reason: string;
}

/** Total units of `good` currently held across all FIFO lots. */
function heldQty(mem: AgentMemory, good: ResourceType | null): number {
  if (!good) return 0;
  let qty = 0;
  for (const lot of mem.inventoryLots) if (lot.good === good) qty += lot.qty;
  return qty;
}

/** True when the agent is carrying no cargo at all (free to start a fresh buy). */
function holdsNothing(mem: AgentMemory): boolean {
  return mem.inventoryLots.every((l) => l.qty <= 0);
}

/** Whether `planetId` is one of the planets in the player's current system. */
function planetInSystem(obs: Observation, planetId: string | null): boolean {
  if (!planetId) return false;
  return (obs.system?.planets ?? []).some((p) => p.id === planetId);
}

/** Whether `stationId` is one of the stations in the player's current system. */
function stationInSystem(obs: Observation, stationId: string | null): boolean {
  if (!stationId) return false;
  return (obs.system?.stations ?? []).some((s) => s.id === stationId);
}

/** The in-system planet the agent prefers to head to for generic earning. */
function earnPlanetId(obs: Observation): string | undefined {
  const planets = obs.system?.planets ?? [];
  const withWork = planets.find((p) => p.availableQuests > 0);
  return (withWork ?? planets[0])?.id;
}

/**
 * The pure decision core: choose one legal {@link Action} for `obs` given the
 * `mem` belief state. Builds a survive→trade→earn→explore ranked candidate list
 * (memory-aware) and returns the first candidate the current scene legally
 * permits, with `"wait"` as the guaranteed floor. Never mutates either argument
 * and never throws — the same `(obs, mem)` always yields the same action.
 */
export function decideWithMemory(obs: Observation, mem: AgentMemory): Action {
  const legal = new Set(obs.legalActions);
  const candidates: Candidate[] = [];
  const push = (kind: PlayerActionKind, reason: string, targetId?: string) =>
    candidates.push({ kind, targetId, reason });

  const hull = obs.player?.hullFraction ?? 1;
  const hurt = hull < LOW_HULL_FRACTION;
  const credits = obs.player?.credits ?? 0;
  const cargoUsed = obs.player?.cargoUsed ?? 0;
  const cargoCap = obs.player?.cargoCapacity ?? 0;
  const hasHold = cargoCap > 0 && cargoUsed < cargoCap;

  // 1) Survive — react to a present threat first, then patch a low hull.
  if (obs.hostiles.length > 0) {
    const tid = obs.hostiles[0]?.id;
    if (hurt) {
      push("flee", "flee-low-hull", tid);
      push("attack", "fight", tid);
    } else {
      push("attack", "fight", tid);
      push("flee", "flee", tid);
    }
  }
  if (hurt) {
    push("repair", "repair-low-hull");
    push("dock", "dock-to-repair", obs.system?.stations[0]?.id);
  }

  const best = bestKnownMargin(mem);
  const offer = cheapestKnownOffer(mem);
  const canAffordOffer = offer ? credits >= offer.price : false;
  const danger = routeDangerToGoal(obs, mem);
  // Heading into a remembered-dangerous goal while not battle-ready ⇒ hold back.
  const avoidDanger = danger > 0 && hull < BATTLE_READY_HULL_FRACTION;

  // 2) Memory-driven trade + goal sequencing, by scene.
  switch (obs.scene) {
    case SceneType.PLANET: {
      const landedId = obs.currentPlanet?.id ?? null;
      // Sell held cargo here when the remembered buy-price says it profits.
      const profitHere = profitIfSoldHere(obs, mem);
      if (profitHere > 0) push("trade", `sell-for-profit:${profitHere}`);
      // Buy low: standing on the cheapest source for a known cross-planet margin,
      // with credits + hold space and nothing already in tow.
      const buyPrice =
        best.good != null
          ? (obs.currentPlanet?.market.find((m) => m.resource === best.good)
              ?.buy ?? Infinity)
          : Infinity;
      if (
        best.good != null &&
        best.buyPlanet === landedId &&
        holdsNothing(mem) &&
        hasHold &&
        credits >= buyPrice
      ) {
        push("trade", `buy-low:${best.good}`);
      }
      // Earn — take offered work, else inspect the market, else take off.
      if ((obs.currentPlanet?.availableQuests ?? 0) > 0)
        push("take-quest", "take-work");
      push("trade", "inspect-market");
      push("move", "take-off");
      break;
    }
    case SceneType.SPACE_FLIGHT: {
      // Realise a known sell: holding the good and its sell planet is in-system.
      if (
        best.good != null &&
        heldQty(mem, best.good) > 0 &&
        planetInSystem(obs, best.sellPlanet)
      ) {
        push("land", "go-sell", best.sellPlanet ?? undefined);
      }
      // Start a known buy: empty hold and the cheap source is in-system.
      if (
        best.good != null &&
        holdsNothing(mem) &&
        planetInSystem(obs, best.buyPlanet)
      ) {
        push("land", "go-buy", best.buyPlanet ?? undefined);
      }
      // Pursue an affordable upgrade: route to the offer's in-system location.
      if (offer && canAffordOffer) {
        if (planetInSystem(obs, offer.location))
          push("land", "go-upgrade", offer.location);
        else if (stationInSystem(obs, offer.location))
          push("dock", "go-upgrade", offer.location);
      }
      // Generic earn — head to local commerce.
      push("land", "earn", earnPlanetId(obs));
      push("dock", "earn", obs.system?.stations[0]?.id);
      // Explore — but don't warp deeper into a remembered threat while hurt.
      if (avoidDanger) {
        push("move", "avoid-danger-hold");
        push("warp", "explore");
      } else {
        push("warp", "explore");
        push("move", "fly");
      }
      break;
    }
    case SceneType.STAR_MAP: {
      // Don't jump toward a remembered threat while not battle-ready.
      if (avoidDanger) push("move", "avoid-danger-back");
      push("warp", "warp");
      push("move", "back");
      break;
    }
    case SceneType.STATION: {
      push("repair", "repair");
      push("move", "leave");
      break;
    }
    case SceneType.TRADE: {
      // The market's buy/sell executor lives off-screen; back out to flight.
      push("move", "leave-market");
      break;
    }
    default: {
      // Dialogue / inventory / equipment / terminal screens — read and back out.
      push("move", "back");
      break;
    }
  }

  push("wait", "idle"); // universal fallback — always legal.

  const pick = candidates.find((c) => legal.has(c.kind)) ?? {
    kind: "wait" as PlayerActionKind,
    reason: "idle",
  };
  return {
    kind: pick.kind,
    targetId: pick.targetId,
    reason: `mem:${pick.reason}`,
  };
}

/**
 * The memory-using player. A thin stateful adapter over {@link decideWithMemory}:
 * it owns a **per-run** {@link AgentMemory} notebook and, when called as a plain
 * {@link PlayerPolicy} (`decide(obs)`), folds each observation in before deciding,
 * so belief accumulates across the agent loop. Pass an explicit `memory` (the
 * agent-owned notebook, already updated for this step) to use it directly without
 * a second fold. Call {@link reset} on a new game to start fresh (a human starting
 * over). Construct once per run.
 */
export class MemoryHeuristicPolicy implements PlayerPolicy {
  readonly name = "memory-heuristic";

  private memory: AgentMemory;

  constructor(memory?: AgentMemory) {
    this.memory = memory ?? createMemory();
  }

  /** The current belief notebook (inspectable for transcripts / tests). */
  get belief(): AgentMemory {
    return this.memory;
  }

  /** Start a fresh per-run notebook — call when a new game begins. */
  reset(): void {
    this.memory = createMemory();
  }

  /**
   * Choose one legal action. With an explicit `memory` (the agent already folded
   * this step's observation in — Task 5 wiring), decide over it directly. Without
   * one, self-manage: fold `obs` into the owned notebook, then decide — so a bare
   * `decide(obs)` is a drop-in {@link PlayerPolicy} whose belief grows step over
   * step. Pure-cored, never throws, always returns a legal action.
   */
  decide(obs: Observation, memory?: AgentMemory): Action {
    if (memory) return decideWithMemory(obs, memory);
    this.memory = updateMemory(this.memory, obs);
    return decideWithMemory(obs, this.memory);
  }
}
