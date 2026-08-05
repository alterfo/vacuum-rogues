import { Container, Graphics } from "pixi.js";
import { dashedPolyline } from "@/utils/flightGeometry";

export class RouteRenderer {
  private readonly gameLayer: Container;
  private routeLineGraphics: Graphics | null = null;

  constructor(gameLayer: Container) {
    this.gameLayer = gameLayer;
  }

  get graphics(): Graphics | null {
    return this.routeLineGraphics;
  }

  drawRoute(path: { x: number; y: number }[]): void {
    if (this.routeLineGraphics) {
      this.gameLayer.removeChild(this.routeLineGraphics);
      this.routeLineGraphics.destroy();
    }

    this.routeLineGraphics = new Graphics();
    this.routeLineGraphics.eventMode = "none";

    const points = path;

    const dashLength = 20;
    const gapLength = 10;

    for (const dash of dashedPolyline(points, dashLength, gapLength)) {
      this.routeLineGraphics.moveTo(dash[0].x, dash[0].y);
      for (let i = 1; i < dash.length; i++) {
        this.routeLineGraphics.lineTo(dash[i].x, dash[i].y);
      }
    }

    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.6 });

    this.gameLayer.addChild(this.routeLineGraphics);
  }

  drawLandingMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    this.routeLineGraphics.circle(x, y, 12);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 2, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 16);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 1.5, alpha: 0.4 });

    const arrowSize = 8;
    const arrowWidth = 5;

    this.routeLineGraphics.moveTo(x, y - arrowSize);
    this.routeLineGraphics.lineTo(x, y + arrowSize * 0.3);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 3, alpha: 1.0 });

    this.routeLineGraphics
      .poly([
        x,
        y + arrowSize, // Bottom point
        x - arrowWidth,
        y, // Left point
        x + arrowWidth,
        y, // Right point
      ])
      .fill({ color: 0xff9900, alpha: 1.0 });

    this.routeLineGraphics.moveTo(x - 8, y + arrowSize + 4);
    this.routeLineGraphics.lineTo(x + 8, y + arrowSize + 4);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 1.5, alpha: 0.7 });
  }

  drawNavigationMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    this.routeLineGraphics.circle(x, y, 8);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 11);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 1.5, alpha: 0.4 });
  }

  drawDayMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    const r = 6;
    this.routeLineGraphics
      .poly([x, y - r, x + r, y, x, y + r, x - r, y], true)
      .stroke({ color: 0xff00ff, width: 2, alpha: 0.8 });
  }

  clearRoute(): void {
    if (this.routeLineGraphics) {
      this.gameLayer.removeChild(this.routeLineGraphics);
      if (!this.routeLineGraphics.destroyed) this.routeLineGraphics.destroy();
      this.routeLineGraphics = null;
    }
  }
}
