import { Container, Graphics } from "pixi.js";
import type { Renderer } from "../Renderer";
import type { Galaxy } from "@/domain/Galaxy";
import { SYSTEM_GEOMETRY } from "@/config/balance";
import type { FlightModule } from "./FlightModule";

export class OrbitRenderer implements FlightModule {
  private readonly gameLayer: Container;
  private readonly galaxy: Galaxy | null;
  private readonly currentSystemId: string;
  private readonly centerX: number;
  private readonly centerY: number;

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

  initialize(): void {
    this.container = new Container();
    this.container.eventMode = "none"; // decorative — never intercept clicks
    this.createOrbits();
    this.createSystemBoundary();
    this.gameLayer.addChild(this.container);
  }

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

    const uniqueRadii = new Set<number>();
    for (const planet of currentSystem.planets) {
      uniqueRadii.add(planet.orbitalRadius);
    }

    for (const radius of uniqueRadii) {
      orbitGraphics.circle(this.centerX, this.centerY, radius);
      orbitGraphics.stroke({ color: 0x444444, width: 1, alpha: 0.3 });
    }

    this.container.addChild(orbitGraphics);
  }

  private createSystemBoundary(): void {
    if (!this.container) return;
    const ring = new Graphics();
    ring.circle(this.centerX, this.centerY, SYSTEM_GEOMETRY.boundaryRadius);
    ring.stroke({ width: 2, color: 0x2266aa, alpha: 0.35 });
    ring.eventMode = "none";
    ring.visible = false; // do not highlight the system edge
    this.container.addChild(ring);
  }
}
