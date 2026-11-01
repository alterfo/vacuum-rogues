import { Container, Graphics, Text } from "pixi.js";
import type { FederatedPointerEvent } from "pixi.js";
import type { Planet } from "@/domain/Planet";
import { logger } from "@/utils/logger";
import { radarToWorld } from "@/utils/flightGeometry";
import { isCameraOnPlayer } from "@/utils/cameraCenter";
import { UiButton } from "./ui/UiButton";
import { scaledText } from "./ui/scaledText";

export class SystemMiniMap {
  public readonly container: Container;
  private readonly mapWidth: number = 180;
  private readonly mapHeight: number = 180;
  private readonly mapScale: number = 0.03;
  private readonly graphics: Graphics;

  private lastCenterX = 0;
  private lastCenterY = 0;
  private onPan: ((worldX: number, worldY: number) => void) | null = null;
  private dragging = false;
  private centerButton: UiButton | null = null;
  private onReturnCamera: (() => void) | null = null;
  private screenW = 0;
  private screenH = 0;
  private systemNameLabel: Text | null = null;
  private currentSystemName: string = "СИСТЕМА";

  constructor(screenWidth: number, screenHeight: number) {
    this.container = new Container();
    this.container.eventMode = "static";
    this.screenW = screenWidth;
    this.screenH = screenHeight;

    this.drawBackground();

    this.graphics = new Graphics();
    this.container.addChild(this.graphics);

    const clip = new Graphics();
    clip.rect(0, 0, this.mapWidth, this.mapHeight);
    clip.fill({ color: 0xffffff });
    this.container.addChild(clip);
    this.graphics.mask = clip;

    this.drawFrame();
    this.createCenterButton();
    this.setupDragToPan();

    this.container.x = screenWidth - this.mapWidth - 20;
    this.container.y = screenHeight - this.mapHeight - 20;

    logger.info(
      `📡 Minimap created at position (${this.container.x}, ${this.container.y})`,
    );
  }

  setPanHandler(handler: (worldX: number, worldY: number) => void): void {
    this.onPan = handler;
  }

  setReturnCameraHandler(handler: () => void): void {
    this.onReturnCamera = handler;
  }

  reposition(screenWidth: number, screenHeight: number): void {
    this.screenW = screenWidth;
    this.screenH = screenHeight;
    this.container.x = screenWidth - this.mapWidth - 20;
    this.container.y = screenHeight - this.mapHeight - 20;
  }

  updateCenterButton(
    cameraPanX: number,
    cameraPanY: number,
    shipX: number,
    shipY: number,
    zoom: number,
  ): void {
    if (!this.centerButton) return;
    const onPlayer = isCameraOnPlayer(
      cameraPanX,
      cameraPanY,
      shipX,
      shipY,
      this.screenW,
      this.screenH,
      zoom,
    );
    this.centerButton.visible = !onPlayer;
  }

  private createCenterButton(): void {
    const BW = 28;
    const BH = 28;
    const PAD = 4;

    const btn = new UiButton(
      "⊙",
      "",
      "neutral",
      (e: FederatedPointerEvent) => {
        e.stopPropagation();
        this.onReturnCamera?.();
      },
      BW,
      BH,
    );
    btn.x = this.mapWidth - BW;
    btn.y = -(BH + PAD);
    btn.visible = false; // hidden until camera is panned away from ship

    this.container.addChild(btn.container);
    this.centerButton = btn;
  }

  private setupDragToPan(): void {
    const hit = new Graphics();
    hit.rect(0, 0, this.mapWidth, this.mapHeight);
    hit.fill({ color: 0xffffff, alpha: 0.001 }); // invisible but hit-testable
    hit.eventMode = "static";
    hit.cursor = "grab";

    const toWorld = (e: FederatedPointerEvent) => {
      const local = e.getLocalPosition(this.container);
      return radarToWorld(
        local.x,
        local.y,
        this.mapWidth,
        this.mapHeight,
        this.mapScale,
        this.lastCenterX,
        this.lastCenterY,
      );
    };

    hit.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.dragging = true;
      hit.cursor = "grabbing";
      const { x, y } = toWorld(e);
      this.onPan?.(x, y);
    });
    hit.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      e.stopPropagation();
      const { x, y } = toWorld(e);
      this.onPan?.(x, y);
    });
    const end = () => {
      this.dragging = false;
      hit.cursor = "grab";
    };
    hit.on("pointerup", end);
    hit.on("pointerupoutside", end);

    this.container.addChild(hit);
  }

  private drawBackground(): void {
    const background = new Graphics();
    background.rect(0, 0, this.mapWidth, this.mapHeight);
    background.fill({ color: 0x000000, alpha: 0.85 });
    this.container.addChild(background);
  }

  updateSystemName(systemName?: string): void {
    if (systemName === undefined) return;
    this.currentSystemName = systemName;
    if (this.systemNameLabel) {
      this.systemNameLabel.text = systemName;
    }
  }

  private drawFrame(): void {
    const frame = new Graphics();
    frame.rect(0, 0, this.mapWidth, this.mapHeight);
    frame.stroke({ color: 0x00ffff, width: 3 });

    const title = scaledText(this.currentSystemName, 10, 0x00ffff, {
      rawColor: true,
      fontWeight: "bold",
    });
    title.x = 5;
    title.y = 5;
    this.systemNameLabel = title;
    frame.addChild(title);

    this.container.addChild(frame);
  }

  update(
    planets: Planet[],
    shipX: number,
    shipY: number,
    centerX: number,
    centerY: number,
  ): void {
    this.graphics.clear();

    const mapCenterX = this.mapWidth / 2;
    const mapCenterY = this.mapHeight / 2 + 10; // Offset down to account for title

    this.graphics.circle(mapCenterX, mapCenterY, 4);
    this.graphics.fill({ color: 0xffaa00 });

    for (const planet of planets) {
      const orbitRadius = planet.orbitalRadius * this.mapScale;

      this.graphics.circle(mapCenterX, mapCenterY, orbitRadius);
      this.graphics.stroke({ color: 0x444444, width: 1, alpha: 0.5 });
    }

    const shipRelativeX = (shipX - centerX) * this.mapScale;
    const shipRelativeY = (shipY - centerY) * this.mapScale;
    const shipMapX = mapCenterX + shipRelativeX;
    const shipMapY = mapCenterY + shipRelativeY;

    this.graphics.poly([
      shipMapX + 3,
      shipMapY,
      shipMapX - 2,
      shipMapY - 2,
      shipMapX - 2,
      shipMapY + 2,
    ]);
    this.graphics.fill({ color: 0x4488cc });
  }

  updateWithSprites(
    planetSprites: { planet: Planet; screenX: number; screenY: number }[],
    shipX: number,
    shipY: number,
    centerX: number,
    centerY: number,
    npcDots: {
      x: number;
      y: number;
      color: number;
      aggressive?: boolean;
    }[] = [],
    route: { x: number; y: number } | null = null,
    boundaryRadius: number | null = null,
    viewport: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    } | null = null,
    scannerRange: number | null = null,
  ): void {
    this.lastCenterX = centerX;
    this.lastCenterY = centerY;
    this.graphics.clear();

    if (Math.random() < 0.016) {
      logger.debug(
        `📡 Minimap update: ${planetSprites.length} planets, ship at (${shipX.toFixed(0)}, ${shipY.toFixed(0)})`,
      );
    }

    const mapCenterX = this.mapWidth / 2;
    const mapCenterY = this.mapHeight / 2 + 10;

    if (boundaryRadius) {
      const br = boundaryRadius * this.mapScale;
      this.graphics.circle(mapCenterX, mapCenterY, br);
      this.graphics.stroke({ color: 0x224a6a, width: 1, alpha: 0.6 });
    }

    this.graphics.circle(mapCenterX, mapCenterY, 5);
    this.graphics.fill({ color: 0xffaa00 });
    this.graphics.circle(mapCenterX, mapCenterY, 3);
    this.graphics.fill({ color: 0xffffaa });

    const uniqueRadii = new Set<number>();
    for (const sprite of planetSprites) {
      uniqueRadii.add(sprite.planet.orbitalRadius);
    }

    for (const radius of uniqueRadii) {
      const orbitRadius = radius * this.mapScale;
      this.graphics.circle(mapCenterX, mapCenterY, orbitRadius);
      this.graphics.stroke({ color: 0x444444, width: 1, alpha: 0.4 });
    }

    for (const sprite of planetSprites) {
      const relativeX = (sprite.screenX - centerX) * this.mapScale;
      const relativeY = (sprite.screenY - centerY) * this.mapScale;
      const planetMapX = mapCenterX + relativeX;
      const planetMapY = mapCenterY + relativeY;

      const color = this.getPlanetColor(sprite.planet.type);
      this.graphics.circle(planetMapX, planetMapY, 3);
      this.graphics.fill({ color });
    }

    for (const dot of npcDots) {
      const nx = mapCenterX + (dot.x - centerX) * this.mapScale;
      const ny = mapCenterY + (dot.y - centerY) * this.mapScale;
      this.graphics.circle(nx, ny, 2);
      this.graphics.fill({ color: dot.color });
      if (dot.aggressive) {
        this.graphics.circle(nx, ny, 4);
        this.graphics.stroke({ color: 0xff3333, width: 1, alpha: 0.9 });
      }
    }

    const shipMapX = mapCenterX + (shipX - centerX) * this.mapScale;
    const shipMapY = mapCenterY + (shipY - centerY) * this.mapScale;

    if (scannerRange) {
      const sr = scannerRange * this.mapScale;
      this.graphics.circle(shipMapX, shipMapY, sr);
      this.graphics.fill({ color: 0x0a3a1a, alpha: 0.22 });
      this.graphics.circle(shipMapX, shipMapY, sr);
      this.graphics.stroke({ color: 0x33ff66, width: 1.5, alpha: 0.9 });
    }

    if (route) {
      const tx = mapCenterX + (route.x - centerX) * this.mapScale;
      const ty = mapCenterY + (route.y - centerY) * this.mapScale;
      const dx = tx - shipMapX;
      const dy = ty - shipMapY;
      const len = Math.hypot(dx, dy);
      const dots = Math.max(1, Math.floor(len / 4));
      for (let i = 1; i <= dots; i++) {
        const t = i / dots;
        const r = Math.round(0x33 + (0xff - 0x33) * t);
        const g = Math.round(0xff + (0x99 - 0xff) * t);
        const b = Math.round(0x66 + (0x33 - 0x66) * t);
        this.graphics.circle(shipMapX + dx * t, shipMapY + dy * t, 1);
        this.graphics.fill({ color: (r << 16) | (g << 8) | b, alpha: 0.9 });
      }
      this.graphics.circle(tx, ty, 2.4);
      this.graphics.stroke({ color: 0xff9933, width: 1 });
    }

    if (viewport) {
      const vx1 = mapCenterX + (viewport.minX - centerX) * this.mapScale;
      const vy1 = mapCenterY + (viewport.minY - centerY) * this.mapScale;
      const vx2 = mapCenterX + (viewport.maxX - centerX) * this.mapScale;
      const vy2 = mapCenterY + (viewport.maxY - centerY) * this.mapScale;
      const cx1 = Math.max(2, Math.min(this.mapWidth - 2, vx1));
      const cy1 = Math.max(14, Math.min(this.mapHeight - 2, vy1));
      const cx2 = Math.max(2, Math.min(this.mapWidth - 2, vx2));
      const cy2 = Math.max(14, Math.min(this.mapHeight - 2, vy2));
      this.graphics.rect(cx1, cy1, cx2 - cx1, cy2 - cy1);
      this.graphics.stroke({ color: 0xffffff, width: 1, alpha: 0.85 });
    }

    this.graphics.poly([
      shipMapX + 4,
      shipMapY,
      shipMapX - 3,
      shipMapY - 3,
      shipMapX - 3,
      shipMapY + 3,
    ]);
    this.graphics.fill({ color: 0x4488cc });

    this.graphics.circle(shipMapX, shipMapY, 6);
    this.graphics.stroke({ color: 0x00ffff, width: 1 });
  }

  private getPlanetColor(type: string): number {
    switch (type) {
      case "TERRESTRIAL":
        return 0x8b7355;
      case "GAS_GIANT":
        return 0xffa500;
      case "ICE":
        return 0xadd8e6;
      case "VOLCANIC":
        return 0xff4500;
      case "INDUSTRIAL":
        return 0x808080;
      case "HABITAT":
        return 0x00aa44;
      default:
        return 0x8b7355;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
