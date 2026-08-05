import type { SystemMiniMap } from "../SystemMiniMap";
import type { PlanetSprite } from "../PlanetSprite";

interface Vec2 {
  x: number;
  y: number;
}

export interface MiniMapUpdateArgs {
  miniMap: SystemMiniMap | null;
  ship: {
    shipX: number;
    shipY: number;
    isMoving: boolean;
    getTargetX(): number;
    getTargetY(): number;
  } | null;
  npcDots: { x: number; y: number; color: number; aggressive: boolean }[];
  planetSprites: PlanetSprite[];
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

export function updateFlightMiniMap(args: MiniMapUpdateArgs): void {
  const { miniMap, ship } = args;
  if (!miniMap || !ship) return;
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
