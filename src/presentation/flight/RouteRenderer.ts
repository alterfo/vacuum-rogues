import { Container, Graphics } from "pixi.js";
import { dashedPolyline, dayTickMarks } from "@/utils/flightGeometry";

/**
 * Draws the planned-course overlay: the dashed cyan line from the ship through
 * its waypoints to the destination, the yellow per-day tick marks along it, and
 * the end-of-route marker (a landing target for planets, a navigation pip for
 * empty space).
 *
 * The renderer is stateless with respect to game logic — it owns only the
 * `Graphics` it draws into and renders exactly what it is told. Route planning
 * (where the path bows around the star, whether the destination is a planet)
 * lives in {@link SpaceFlightScene}, the Information Expert for route data; the
 * scene hands this renderer the finished polyline and the marker decision.
 *
 * It is intentionally NOT a {@link FlightModule}: there is nothing to advance
 * per frame (the line is redrawn on demand when the route changes), so it has
 * no `initialize`/`update` lifecycle — just draw and clear.
 */
export class RouteRenderer {
  private readonly gameLayer: Container;
  /** The single overlay all route geometry + markers are drawn into. */
  private routeLineGraphics: Graphics | null = null;

  constructor(gameLayer: Container) {
    this.gameLayer = gameLayer;
  }

  /** The current route overlay, or null when no route is drawn (test access). */
  get graphics(): Graphics | null {
    return this.routeLineGraphics;
  }

  /**
   * Draw the dashed course line + per-day tick marks for `path` — the polyline
   * from the ship's position through any curved waypoints to the destination.
   * Replaces any previously drawn route. The end marker is drawn separately via
   * {@link drawLandingMarker}/{@link drawNavigationMarker} so the scene keeps
   * the landing-vs-navigation decision (it owns the planet data).
   *
   * @param path Polyline points (ship start → waypoints → destination).
   * @param distancePerDay Pixels per game day, for spacing the day tick marks.
   */
  drawRoute(path: { x: number; y: number }[], distancePerDay: number): void {
    // Remove old route line
    if (this.routeLineGraphics) {
      this.gameLayer.removeChild(this.routeLineGraphics);
      this.routeLineGraphics.destroy();
    }

    // Create new route line. Non-interactive so its dashes/markers can never
    // sit over a ship and swallow its click (US-070 #7).
    this.routeLineGraphics = new Graphics();
    this.routeLineGraphics.eventMode = "none";

    const points = path;

    const dashLength = 20;
    const gapLength = 10;

    // Dash the polyline as ONE continuous walk — the pattern phase carries
    // across vertices, so the dense sun-bypass spline (segments shorter than
    // the dash period) is dashed seamlessly instead of disappearing
    // (playtest 2 ③: the route line stopped and resumed around the arc).
    for (const dash of dashedPolyline(points, dashLength, gapLength)) {
      this.routeLineGraphics.moveTo(dash[0].x, dash[0].y);
      for (let i = 1; i < dash.length; i++) {
        this.routeLineGraphics.lineTo(dash[i].x, dash[i].y);
      }
    }

    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.6 });

    // Per-day tick marks along the route: a short perpendicular dash every
    // distancePerDay pixels, so the player can read how many days the trip
    // takes (like the day "divisions" in the original game). See dayTickMarks.
    const tickLen = 6;
    for (const t of dayTickMarks(points, distancePerDay)) {
      this.routeLineGraphics.moveTo(t.x - t.px * tickLen, t.y - t.py * tickLen);
      this.routeLineGraphics.lineTo(t.x + t.px * tickLen, t.y + t.py * tickLen);
    }
    this.routeLineGraphics.stroke({ color: 0xffee66, width: 2, alpha: 0.9 });

    this.gameLayer.addChild(this.routeLineGraphics);
  }

  /**
   * Draw a landing marker (downward arrow + landing circles) at (x,y) onto the
   * current route overlay. No-op if no route line has been drawn yet.
   */
  drawLandingMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    // Outer landing zone circles (kept compact so the marker doesn't swamp the
    // planet it points at).
    this.routeLineGraphics.circle(x, y, 12);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 2, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 16);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 1.5, alpha: 0.4 });

    // Downward arrow (landing symbol)
    const arrowSize = 8;
    const arrowWidth = 5;

    // Arrow shaft
    this.routeLineGraphics.moveTo(x, y - arrowSize);
    this.routeLineGraphics.lineTo(x, y + arrowSize * 0.3);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 3, alpha: 1.0 });

    // Arrow head (triangle pointing down)
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

    // Small base platform indicator
    this.routeLineGraphics.moveTo(x - 8, y + arrowSize + 4);
    this.routeLineGraphics.lineTo(x + 8, y + arrowSize + 4);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 1.5, alpha: 0.7 });
  }

  /**
   * Draw a navigation marker (pulsing circles) at (x,y) onto the current route
   * overlay for empty-space movement. No-op if no route line has been drawn yet.
   */
  drawNavigationMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    // Pulsing circles for generic navigation target (compact)
    this.routeLineGraphics.circle(x, y, 8);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 11);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 1.5, alpha: 0.4 });
  }

  /** Remove and dispose the route overlay (called when the route is cleared). */
  clearRoute(): void {
    if (this.routeLineGraphics) {
      this.gameLayer.removeChild(this.routeLineGraphics);
      // Guard: during scene teardown clearGameLayer() destroys this Graphics
      // before clearPlannedRoute() reaches here — destroying it twice throws.
      if (!this.routeLineGraphics.destroyed) this.routeLineGraphics.destroy();
      this.routeLineGraphics = null;
    }
  }
}
