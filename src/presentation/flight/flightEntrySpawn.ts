import { takeoffArcPath, type Point } from "@/utils/flightGeometry";
import type { ShipPhysics } from "@/systems/ShipPhysics";

export interface EntrySpawnDeps {
  shipPhysics: ShipPhysics | null;
  starCenter: { x: number; y: number };
  findPlanetSprite: (
    planetId: string,
  ) => { screenX: number; screenY: number; displayRadius: number } | undefined;
  findStationMarker: (
    stationId: string,
  ) => { x: number; y: number } | undefined;
  findStationDomainPos: (stationId: string) => Point | undefined;
  findPlanetDomainPos: (
    planetId: string,
  ) => (Point & { radius: number }) | undefined;
  startTakeoffArc: (arc: Point[]) => void;
  setShipContainerPos: (x: number, y: number) => void;
  landedPlanetId: string | null | undefined;
  clearLandedPlanetId: () => void;
}

export function spawnShipBeside(
  deps: EntrySpawnDeps,
  bodyX: number,
  bodyY: number,
  bodyRadius: number,
  margin = 40,
): void {
  const ship = deps.shipPhysics;
  if (!ship) return;
  const dx = bodyX - deps.starCenter.x;
  const dy = bodyY - deps.starCenter.y;
  const len = Math.hypot(dx, dy) || 1;
  const spawnX = bodyX + (dx / len) * (bodyRadius + margin);
  const spawnY = bodyY + (dy / len) * (bodyRadius + margin);
  ship.teleport(spawnX, spawnY);
  deps.setShipContainerPos(spawnX, spawnY);
}

export function applyReentrySpawn(
  deps: EntrySpawnDeps,
  fromStationId?: string,
): void {
  if (!deps.shipPhysics) return;

  if (fromStationId) {
    const pos =
      deps.findStationMarker(fromStationId) ??
      deps.findStationDomainPos(fromStationId);
    if (pos) {
      spawnShipBeside(deps, pos.x, pos.y, 20);
      deps.clearLandedPlanetId();
      return;
    }
  }

  const landedId = deps.landedPlanetId;
  if (landedId) {
    const sprite = deps.findPlanetSprite(landedId);
    const pos = sprite
      ? { x: sprite.screenX, y: sprite.screenY, radius: sprite.displayRadius }
      : deps.findPlanetDomainPos(landedId);
    if (pos) {
      spawnShipBeside(deps, pos.x, pos.y, pos.radius);
    }
    deps.clearLandedPlanetId();
  }
}

export function applyEntrySpawn(
  deps: EntrySpawnDeps,
  ctx?: {
    preserveShipPos?: { x: number; y: number };
    fromPlanetId?: string;
    fromStationId?: string;
  },
): void {
  const ship = deps.shipPhysics;
  if (!ship) return;

  if (ctx?.preserveShipPos) {
    ship.teleport(ctx.preserveShipPos.x, ctx.preserveShipPos.y);
    return;
  }

  if (ctx?.fromPlanetId) {
    const sprite = deps.findPlanetSprite(ctx.fromPlanetId);
    if (sprite) {
      const dx = sprite.screenX - deps.starCenter.x;
      const dy = sprite.screenY - deps.starCenter.y;
      const len = Math.hypot(dx, dy) || 1;
      const arc = takeoffArcPath(
        sprite.screenX,
        sprite.screenY,
        dx / len,
        dy / len,
        sprite.displayRadius,
        90,
      );
      const end = arc[arc.length - 1];
      ship.teleport(end.x, end.y);
      deps.startTakeoffArc(arc);
    } else {
      const pos = deps.findPlanetDomainPos(ctx.fromPlanetId);
      if (pos) spawnShipBeside(deps, pos.x, pos.y, pos.radius);
    }
    deps.clearLandedPlanetId();
    return;
  }

  applyReentrySpawn(deps, ctx?.fromStationId);
}
