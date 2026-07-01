/**
 * Letsplay engine — the heuristic baseline brain (dev-only).
 *
 * A goal-directed, rule-based {@link PlayerPolicy}. It ranks a small set of
 * action *candidates* by a fixed priority — **survive → earn → explore** — and
 * then returns the first candidate the current scene actually permits. Because
 * the final pick is filtered through `obs.legalActions` (and `"wait"` is legal in
 * every scene), the policy can **never** return an illegal action, and it never
 * throws.
 *
 *  - **Survive.** A hostile in range with a healthy hull ⇒ `attack`; a hostile
 *    with a low hull ⇒ `flee`. Independently, a low hull ⇒ `repair` (at a base)
 *    or `dock` (in flight, to reach one).
 *  - **Earn.** On a planet, take offered work (`take-quest`) else shop the market
 *    (`trade`); in flight, head to commerce — `land` on a planet, else `dock` a
 *    station.
 *  - **Explore.** Nothing local to do ⇒ `warp` to a connected system (or `move`
 *    on a sub-screen back toward flight).
 *
 * The policy is pure and stateless — the same observation always yields the same
 * action. It lives under `src/tests/` and is dev-only.
 */
import { SceneType } from "@/types";
import type { Observation, PlayerActionKind } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";

/** Below this hull fraction the agent prioritises survival (flee / repair). */
export const LOW_HULL_FRACTION = 0.35;

/**
 * The rule-based player. Construct once and reuse — it carries no state, so a
 * single instance is safe to share across sessions.
 */
export class HeuristicPolicy implements PlayerPolicy {
  readonly name = "heuristic";

  /**
   * Rank the candidate action kinds for `obs` by the survive→earn→explore
   * priority, *independent* of legality. The candidate list always ends with
   * `"wait"`, the universally-legal fallback, so the legal-filter below can never
   * come up empty.
   */
  private rankCandidates(obs: Observation): PlayerActionKind[] {
    const list: PlayerActionKind[] = [];
    const hull = obs.player?.hullFraction ?? 1;
    const hurt = hull < LOW_HULL_FRACTION;

    // 1) Survive — react to a present threat first.
    if (obs.hostiles.length > 0) {
      if (hurt) list.push("flee", "attack");
      else list.push("attack", "flee");
    }
    // …and patch the hull whenever it is low, wherever we can.
    if (hurt) list.push("repair", "dock");

    // 2) Earn / 3) Explore — scene-directed.
    switch (obs.scene) {
      case SceneType.PLANET: {
        if ((obs.currentPlanet?.availableQuests ?? 0) > 0)
          list.push("take-quest");
        list.push("trade", "move");
        break;
      }
      case SceneType.TRADE: {
        // No buy/sell executor yet — leave the market rather than spin in it.
        list.push("move");
        break;
      }
      case SceneType.STATION: {
        list.push("repair", "move");
        break;
      }
      case SceneType.STAR_MAP: {
        list.push("warp", "move");
        break;
      }
      case SceneType.SPACE_FLIGHT: {
        // Head to commerce; if nothing is local, explore a neighbour.
        list.push("land", "dock", "warp", "move");
        break;
      }
      default: {
        // Dialogue / inventory / equipment / etc. — read and back out.
        list.push("move");
        break;
      }
    }

    list.push("wait"); // universal fallback — always legal.
    return list;
  }

  /**
   * Resolve the policy's preferred target id for a chosen `kind`, when the
   * observation carries one (which planet/station/hostile). `warp`/`take-quest`
   * targets are left for the agent's applier to resolve from the live engine.
   */
  private targetFor(
    kind: PlayerActionKind,
    obs: Observation,
  ): string | undefined {
    switch (kind) {
      case "land": {
        // Prefer a planet that is offering work, among habitable ones only —
        // uninhabited planets have no market and create a spin-land-takeoff loop.
        const planets = obs.system?.planets ?? [];
        const habitable = planets.filter((p) => p.isHabitable !== false);
        const withWork = habitable.find((p) => p.availableQuests > 0);
        return (withWork ?? habitable[0])?.id; // never fall back to uninhabited
      }
      case "dock":
        return obs.system?.stations[0]?.id;
      case "attack":
      case "flee":
        return obs.hostiles[0]?.id;
      default:
        return undefined;
    }
  }

  decide(obs: Observation): Action {
    const legal = new Set(obs.legalActions);
    const candidates = this.rankCandidates(obs);
    const kind = candidates.find((c) => legal.has(c)) ?? "wait";
    return { kind, targetId: this.targetFor(kind, obs), reason: this.name };
  }
}
