import { Container, Graphics } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { Galaxy } from "@/domain/Galaxy";
import { SYSTEM_GEOMETRY } from "@/config/balance";
import type { FlightModule } from "./FlightModule";

/**
 * Draws the static decorative geometry of the system: the faint orbit circles
 * for each populated orbital radius and the dashed-looking ring marking the
 * system boundary (where ships hyperjump in and out).
 *
 * Both are non-interactive and never animate, so {@link update} is a no-op —
 * they are drawn once in {@link initialize} and torn down in {@link destroy}.
 *
 * The geometry is centred on the system's star, which sits at the screen centre
 * in world coordinates (the same centre {@link StarRenderer} and
 * {@link AsteroidBelt} derive), so the module computes its own centre from the
 * renderer rather than coupling to the star module.
 */
export class OrbitRenderer implements FlightModule {
  private readonly gameLayer: Container;
  private readonly galaxy: Galaxy | null;
  private readonly currentSystemId: string;
  /** World position of the star centre (orbits/boundary are centred on it). */
  private readonly centerX: number;
  private readonly centerY: number;

  /** Holds the orbit circles + boundary ring so destroy() tears down one node. */
  private container: Container | null = null;

  constructor(
    renderer: Renderer,
    gameLayer: Container,
    galaxy: Galaxy | null,
    currentSystemId: string,
  ) {
    this.gameLayer = gameLayer;
    this.galaxy = galaxy;
    this.currentSystemId = currentSystemId;
    this.centerX = renderer.app.screen.width / 2;
    this.centerY = renderer.app.screen.height / 2;
  }

  // ---------------------------------------------------------------------------
  // FlightModule lifecycle
  // ---------------------------------------------------------------------------

  initialize(): void {
    // Single container (above star, below planets) keeps both the orbit circles
    // and the boundary ring as one self-contained node to tear down on destroy.
    this.container = new Container();
    this.container.eventMode = "none"; // decorative — never intercept clicks
    this.createOrbits();
    this.createSystemBoundary();
    this.gameLayer.addChild(this.container);
  }

  /** Orbits and boundary are static decoration — nothing to advance per frame. */
  update(_dt: number, _bgElapsed: number): void {
    // no-op
  }

  destroy(): void {
    if (this.container) {
      if (this.container.parent) {
        this.container.parent.removeChild(this.container);
      }
      if (!this.container.destroyed) {
        this.container.destroy({ children: true });
      }
      this.container = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  /**
   * Draw visible orbital paths for planets — one faint circle per unique
   * orbital radius in the current system.
   */
  private createOrbits(): void {
    const galaxy = this.galaxy;
    if (!galaxy || !this.container) return;

    const currentSystem = galaxy.systems.find(
      (s) => s.id === this.currentSystemId,
    );
    if (
      !currentSystem ||
      !currentSystem.planets ||
      currentSystem.planets.length === 0
    ) {
      return;
    }

    const orbitGraphics = new Graphics();
    orbitGraphics.eventMode = "none"; // decorative — never intercept clicks

    // Get unique orbital radii
    const uniqueRadii = new Set<number>();
    for (const planet of currentSystem.planets) {
      uniqueRadii.add(planet.orbitalRadius);
    }

    // Draw orbit circle for each unique radius
    for (const radius of uniqueRadii) {
      orbitGraphics.circle(this.centerX, this.centerY, radius);
      orbitGraphics.stroke({ color: 0x444444, width: 1, alpha: 0.3 });
    }

    this.container.addChild(orbitGraphics);
  }

  /**
   * Draw the system boundary — the edge where ships hyperjump in and out.
   * Faint dashed-looking ring; non-interactive so it never blocks clicks.
   */
  private createSystemBoundary(): void {
    if (!this.container) return;
    const ring = new Graphics();
    ring.circle(this.centerX, this.centerY, SYSTEM_GEOMETRY.boundaryRadius);
    ring.stroke({ width: 2, color: 0x2266aa, alpha: 0.35 });
    ring.eventMode = "none";
    this.container.addChild(ring);
  }
}
