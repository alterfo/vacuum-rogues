import { NpcRole } from "@/types";
import type { SystemBounds } from "../NpcShipSprite";
import { hashStr } from "@/utils/hashStr";

export interface NpcBehaviorCtx {
  readonly bounds: SystemBounds;
  readonly planets: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly traders?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export type NpcDestinationIntent =
  | "visit_planet"
  | "patrol_station"
  | "hunt"
  | "lane_point";

export interface NpcDestination {
  readonly x: number;
  readonly y: number;
  readonly intent: NpcDestinationIntent;
}

export function pickNpcDestination(
  role: NpcRole,
  shipId: string,
  seq: number,
  ctx: NpcBehaviorCtx,
): NpcDestination {
  const seed = (hashStr(shipId) ^ (seq * 2654435761)) >>> 0;

  switch (role) {
    case NpcRole.TRADER:
    case NpcRole.RANGER: {
      if (ctx.planets.length > 0) {
        const p = ctx.planets[seed % ctx.planets.length];
        return { x: p.x, y: p.y, intent: "visit_planet" };
      }
      return lanePoint(seed, ctx.bounds);
    }

    case NpcRole.PATROL:
    case NpcRole.OVERMIND: {
      if (ctx.planets.length > 0) {
        const p = ctx.planets[seed % ctx.planets.length];
        return { x: p.x, y: p.y, intent: "patrol_station" };
      }
      return lanePoint(seed, ctx.bounds);
    }

    case NpcRole.PIRATE: {
      if (ctx.traders && ctx.traders.length > 0) {
        const t = ctx.traders[seed % ctx.traders.length];
        return { x: t.x, y: t.y, intent: "hunt" };
      }
      return lanePoint(seed, ctx.bounds);
    }

    default:
      return lanePoint(hashStr(shipId), ctx.bounds);
  }
}

function lanePoint(seed: number, bounds: SystemBounds): NpcDestination {
  const angle = (seed / 0x1_0000_0000) * Math.PI * 2;
  const t = ((seed >>> 8) & 0xff) / 255;
  const radius = bounds.rInner + t * (bounds.rOuter - bounds.rInner);
  return {
    x: bounds.cx + Math.cos(angle) * radius,
    y: bounds.cy + Math.sin(angle) * radius,
    intent: "lane_point",
  };
}
