import { SceneType } from "@/types";
import type { Observation, PlayerActionKind } from "./observe";
import type { Action, PlayerPolicy } from "./PlayerPolicy";

export const LOW_HULL_FRACTION = 0.35;

export class HeuristicPolicy implements PlayerPolicy {
  readonly name = "heuristic";

  private rankCandidates(obs: Observation): PlayerActionKind[] {
    const list: PlayerActionKind[] = [];
    const hull = obs.player?.hullFraction ?? 1;
    const hurt = hull < LOW_HULL_FRACTION;

    if (obs.hostiles.length > 0) {
      if (hurt) list.push("flee", "attack");
      else list.push("attack", "flee");
    }
    if (hurt) list.push("repair", "dock");

    switch (obs.scene) {
      case SceneType.PLANET: {
        if ((obs.currentPlanet?.availableQuests ?? 0) > 0)
          list.push("take-quest");
        list.push("trade", "move");
        break;
      }
      case SceneType.TRADE: {
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
        list.push("land", "dock", "warp", "move");
        break;
      }
      default: {
        list.push("move");
        break;
      }
    }

    list.push("wait"); // universal fallback — always legal.
    return list;
  }

  private targetFor(
    kind: PlayerActionKind,
    obs: Observation,
  ): string | undefined {
    switch (kind) {
      case "land": {
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
