/**
 * Per-frame system mini-map refresh. Extracted verbatim from
 * `SpaceFlightScene.updateSystemMiniMap` (which now delegates here) to keep the
 * scene under its line-count guard while the planning-phase UI wiring
 * (Task 14.5b) adds its integration — the same class of extraction as
 * `routePlot.ts`. Behavior is byte-for-byte the same: always refresh (even
 * paused — visual feedback during an overlay), planned destination beats the
 * live movement target on the radar, camera viewport → radar rectangle.
 */

import type { SystemMiniMap } from "../SystemMiniMap";
import type { PlanetSprite } from "../PlanetSprite";

interface Vec2 {
  x: number;
  y: number;
}

/** Live scene state the refresh reads (resolved by the caller each frame). */
export interface MiniMapUpdateArgs {
  miniMap: SystemMiniMap | null;
  /** Live ship physics, or null before the ship spawns. */
  ship: {
    shipX: number;
    shipY: number;
    isMoving: boolean;
    getTargetX(): number;
    getTargetY(): number;
  } | null;
  npcDots: { x: number; y: number; color: number; aggressive: boolean }[];
  planetSprites: PlanetSprite[];
  /** The committed planned destination, or null when nothing is planned. */
  plannedRoute: Vec2 | null;
  starCenter: Vec2;
  camera: {
    worldViewport(): { minX: number; minY: number; maxX: number; maxY: number };
    panX: number;
    panY: number;
    zoom: number;
  };
  boundaryRadius: number;
  scannerRange: number;
}

/** Refresh the radar sprites, route dot and center-button state for one frame. */
export function updateFlightMiniMap(args: MiniMapUpdateArgs): void {
  const { miniMap, ship } = args;
  if (!miniMap || !ship) return;
  // Show the route on the radar: the planned destination (set on planning
  // or while travelling), else the live target while the ship is moving.
  const route =
    args.plannedRoute ??
    (ship.isMoving ? { x: ship.getTargetX(), y: ship.getTargetY() } : null);
  miniMap.updateWithSprites(
    args.planetSprites,
    ship.shipX,
    ship.shipY,
    args.starCenter.x,
    args.starCenter.y,
    args.npcDots,
    route,
    args.boundaryRadius,
    args.camera.worldViewport(),
    args.scannerRange,
  );
  miniMap.updateCenterButton(
    args.camera.panX,
    args.camera.panY,
    ship.shipX,
    ship.shipY,
    args.camera.zoom,
  );
}
