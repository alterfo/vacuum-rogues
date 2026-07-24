import { takeoffArcPath, type Point } from "@/utils/flightGeometry";
import type { ShipPhysics } from "@/systems/ShipPhysics";

/** Deps for the SPACE_FLIGHT entry-spawn decision (Task 9, flight/CLAUDE.md) — extracted from SpaceFlightScene for the line-count guard. */
export interface EntrySpawnDeps {
  shipPhysics: ShipPhysics | null;
  starCenter: { x: number; y: number };
  findPlanetSprite: (
    planetId: string,
  ) => { screenX: number; screenY: number; displayRadius: number } | undefined;
  findStationMarker: (
    stationId: string,
  ) => { x: number; y: number } | undefined;
  startTakeoffArc: (arc: Point[]) => void;
  setShipContainerPos: (x: number, y: number) => void;
  landedPlanetId: string | null | undefined;
  clearLandedPlanetId: () => void;
}

/**
 * Park the ship just outside a body (planet/station) instead of at the system
 * edge — used when re-entering SPACE_FLIGHT after docking/landing (Task 9).
 * Places it `bodyRadius + margin` px out along the radial from the star, so it
 * sits clear of the body's disc and never on top of the star.
 */
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

/**
 * Position the ship after a non-take-off entry to SPACE_FLIGHT (Task 9).
 * Priority: the station we just undocked from (`fromStationId`), else the last
 * planet we landed on (`landedPlanetId`, consumed once). If neither is known
 * the ship keeps its default edge spawn.
 */
export function applyReentrySpawn(
  deps: EntrySpawnDeps,
  fromStationId?: string,
): void {
  if (!deps.shipPhysics) return;

  if (fromStationId) {
    const marker = deps.findStationMarker(fromStationId);
    if (marker) {
      spawnShipBeside(deps, marker.x, marker.y, 20);
      // Consume any pending landing too, so a later free-flight re-entry isn't
      // snapped back to a stale planet (docstring: landedPlanetId is one-shot).
      deps.clearLandedPlanetId();
      return;
    }
  }

  const landedId = deps.landedPlanetId;
  if (landedId) {
    const sprite = deps.findPlanetSprite(landedId);
    if (sprite) {
      spawnShipBeside(
        deps,
        sprite.screenX,
        sprite.screenY,
        sprite.displayRadius,
      );
    }
    // Consume so a later free-flight entry doesn't keep snapping the ship back.
    deps.clearLandedPlanetId();
  }
}

/**
 * Decide where the ship sits on this SPACE_FLIGHT entry. Precedence:
 * `preserveShipPos` (pure HUD re-init, e.g. font-scale change — keep the ship
 * put, playtest4 A) → `fromPlanetId` take-off arc (Task 5) → station/landed-
 * planet spawn (Task 9).
 */
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

  // Took off from a planet → spawn right next to it, not at the system edge.
  if (ctx?.fromPlanetId) {
    const sprite = deps.findPlanetSprite(ctx.fromPlanetId);
    if (sprite) {
      const dx = sprite.screenX - deps.starCenter.x;
      const dy = sprite.screenY - deps.starCenter.y;
      const len = Math.hypot(dx, dy) || 1;
      // Take-off flourish: fly a short outward arc, then hand off to autopilot.
      // teleport() parks physics at the arc END so it's cosmetic (no days burned).
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
    }
    // Took off → no longer parked at the planet, so a later context-less
    // re-entry keeps its own spawn instead of snapping back here.
    deps.clearLandedPlanetId();
    return;
  }

  applyReentrySpawn(deps, ctx?.fromStationId);
}
