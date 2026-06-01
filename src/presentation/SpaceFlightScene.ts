import { GameScene } from "./GameScene";
import {
  Graphics,
  Text,
  Container,
  FederatedPointerEvent,
  BlurFilter,
} from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { PlanetSprite } from "./PlanetSprite";
import { PlanetInfoPanel } from "./PlanetInfoPanel";
import { SystemMiniMap } from "./SystemMiniMap";
import { QuestJournalUI } from "./QuestJournalUI";
import type { Planet } from "@/domain/Planet";
import { logger } from "@/utils/logger";

interface StarLayer {
  container: Container;
  stars: { x: number; y: number; size: number; alpha: number; speed: number }[];
  speed: number;
}

/**
 * Physics-based movement state machine for ship control
 * Implements three-phase movement: acceleration → cruise → deceleration
 */
class ShipPhysics {
  public shipX: number;
  public shipY: number;
  public shipAngle: number;
  public currentSpeed: number = 0;
  public isMoving: boolean = false;

  private targetX: number;
  private targetY: number;
  private readonly maxSpeed: number;
  private readonly acceleration: number = 0.001; // pixels/ms² - speed increase per ms
  private readonly deceleration: number = 0.0015; // pixels/ms² - speed decrease per ms
  private readonly rotationSpeed: number; // radians/ms
  private readonly STOP_THRESHOLD: number = 10; // pixels - distance to consider "arrived"

  constructor(initialX: number, initialY: number, maxSpeed?: number) {
    this.shipX = initialX;
    this.shipY = initialY;
    this.targetX = initialX;
    this.targetY = initialY;
    this.shipAngle = 0;
    this.maxSpeed = maxSpeed ?? 0.1; // pixels/ms - slower for turn-based gameplay (was 0.3)
    // Calculate rotation speed: 90° (π/2 rad) in 300ms = 5.24 rad/s = 0.00524 rad/ms
    this.rotationSpeed = Math.PI / 2 / 300;
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.isMoving = true;
  }

  getDistanceToTarget(): number {
    const dx = this.targetX - this.shipX;
    const dy = this.targetY - this.shipY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getTargetX(): number {
    return this.targetX;
  }

  getTargetY(): number {
    return this.targetY;
  }

  update(deltaTime: number): void {
    // Cap deltaTime to prevent physics explosion on lag spikes
    const dt = Math.min(deltaTime, 100);

    const distance = this.getDistanceToTarget();

    // Check if arrived at target
    if (distance <= this.STOP_THRESHOLD) {
      this.currentSpeed = 0;
      this.isMoving = false;
      // Snap to target if very close
      if (distance < 2) {
        this.shipX = this.targetX;
        this.shipY = this.targetY;
      }
      return;
    }

    // Rotation update - calculate angle to target
    const dx = this.targetX - this.shipX;
    const dy = this.targetY - this.shipY;
    const targetAngle = Math.atan2(dy, dx);

    // Normalize angle difference to [-π, π]
    let angleDiff = targetAngle - this.shipAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    // Apply rotation with maximum rotation per frame
    const maxRotation = this.rotationSpeed * dt;
    if (Math.abs(angleDiff) <= maxRotation) {
      this.shipAngle = targetAngle;
    } else {
      this.shipAngle += Math.sign(angleDiff) * maxRotation;
    }

    // Calculate alignment factor: how well the ship is pointing at target
    // 1.0 = perfectly aligned, 0.0 = perpendicular or worse
    const alignmentFactor = Math.max(0, Math.cos(angleDiff));

    // Only accelerate if ship is reasonably aligned with target (within 60°)
    const isAligned = Math.abs(angleDiff) < Math.PI / 3;

    // Calculate stopping distance: v² / (2a)
    const stoppingDistance =
      (this.currentSpeed * this.currentSpeed) / (2 * this.deceleration);

    // Speed update: accelerate if far from target and aligned, decelerate when approaching
    if (
      distance > stoppingDistance &&
      this.currentSpeed < this.maxSpeed &&
      isAligned
    ) {
      // Acceleration phase - only when pointing at target
      this.currentSpeed = Math.min(
        this.maxSpeed,
        this.currentSpeed + this.acceleration * dt,
      );
    } else if (distance <= stoppingDistance && this.currentSpeed > 0) {
      // Deceleration phase
      this.currentSpeed = Math.max(
        0,
        this.currentSpeed - this.deceleration * dt,
      );
    } else if (!isAligned && this.currentSpeed > this.maxSpeed * 0.3) {
      // Slow down if not aligned and going too fast
      this.currentSpeed = Math.max(
        this.maxSpeed * 0.3,
        this.currentSpeed - this.deceleration * dt * 0.5,
      );
    }

    // Position update - apply alignment factor to prevent sideways drift
    const effectiveSpeed = this.currentSpeed * alignmentFactor;
    const moveDistance = effectiveSpeed * dt;
    this.shipX += Math.cos(this.shipAngle) * moveDistance;
    this.shipY += Math.sin(this.shipAngle) * moveDistance;
  }
}

export class SpaceFlightScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private shipContainer: Container | null = null;
  private shipGraphics: Graphics | null = null;
  private backgroundContainer: Container | null = null; // All background elements (blurred)
  private starLayers: StarLayer[] = [];
  private nebulaeContainer: Container | null = null;
  private shipPhysics: ShipPhysics | null = null;
  private readonly SHIP_SIZE = 20;
  private uiContainer: Container | null = null;

  // Planet rendering
  private planetSprites: PlanetSprite[] = [];
  private planetInfoPanel: PlanetInfoPanel | null = null;
  private starCenterX: number = 0;
  private starCenterY: number = 0;
  private starGraphics: Graphics | null = null;
  private orbitGraphics: Graphics | null = null;
  private systemMiniMap: SystemMiniMap | null = null;

  // Quest Journal UI
  private questJournalUI: QuestJournalUI | null = null;

  // Target indicator
  private targetIndicator: Graphics | null = null;

  // Time tracking for day counter
  private distanceTraveled: number = 0;
  private readonly DISTANCE_PER_DAY: number = 500; // pixels traveled = 1 day
  private readonly LANDING_RANGE: number = 60; // px: how close the ship must be to a planet to land
  private dayCounterText: Text | null = null;

  // Two-step movement: plan route, then execute
  private plannedRoute: { x: number; y: number } | null = null;
  private routeLineGraphics: Graphics | null = null;

  // Continuous input tracking
  private boundPointerDown: ((event: FederatedPointerEvent) => void) | null =
    null;
  private boundPointerMove: ((event: FederatedPointerEvent) => void) | null =
    null;
  private boundPointerUp: (() => void) | null = null;
  private boundKeyDown: ((event: KeyboardEvent) => void) | null = null;

  // Camera zoom and pan
  private cameraZoom: number = 1.0;
  private cameraPanX: number = 0;
  private cameraPanY: number = 0;
  private isPanning: boolean = false;
  private lastPanX: number = 0;
  private lastPanY: number = 0;
  private readonly MIN_ZOOM = 0.5;
  private readonly MAX_ZOOM = 2.0;
  private boundWheel: ((event: WheelEvent) => void) | null = null;

  // Debug display
  private cameraDebugText: Text | null = null;

  initialize(context?: object): void {
    const ctx = context as
      | { gameEngine?: GameEngine; entryVector?: { x: number; y: number } }
      | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;

    const centerX = this.renderer.app.screen.width / 2;
    const centerY = this.renderer.app.screen.height / 2;

    const entryVector = ctx?.entryVector ?? { x: 0, y: 1 };
    const maxOrbit = 600;
    const rawEntryX = centerX + entryVector.x * maxOrbit;
    const rawEntryY = centerY + entryVector.y * maxOrbit;

    // Clamp the entry point into the visible viewport so the player's ship is
    // always on-screen on system entry. The camera starts at zoom 1 / pan 0 and
    // does not follow the ship, so a maxOrbit that exceeds the viewport half-
    // extent (e.g. 600px on a ~717px-tall canvas) would otherwise spawn the
    // ship below the bottom edge, invisible until the player zooms/pans.
    const screenW = this.renderer.app.screen.width;
    const screenH = this.renderer.app.screen.height;
    const entryMargin = this.SHIP_SIZE * 2;
    const entryX = Math.max(
      entryMargin,
      Math.min(screenW - entryMargin, rawEntryX),
    );
    const entryY = Math.max(
      entryMargin,
      Math.min(screenH - entryMargin, rawEntryY),
    );
    const maxSpeed = this.gameEngine?.player?.ship.speed ?? undefined;
    this.shipPhysics = new ShipPhysics(entryX, entryY, maxSpeed);

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Store star center position
    this.starCenterX = centerX;
    this.starCenterY = centerY;

    // Create blurred background container for all distant objects
    this.backgroundContainer = new Container();
    this.backgroundContainer.filters = [new BlurFilter({ strength: 1.5 })];
    this.renderer.gameLayer.addChild(this.backgroundContainer);

    this.createStarField();
    this.createNebulae();
    this.createStar();
    this.createOrbits();
    this.createPlanets(); // Planets added to gameLayer directly (not blurred)
    this.createShip();
    this.createTargetIndicator();
    this.createUI();

    // Initialize camera transform (sets initial state)
    this.applyCameraTransform();

    // Enable interactivity on stage for continuous pointer tracking
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.renderer.app.stage.eventMode = "static";
    this.renderer.app.stage.hitArea = this.renderer.app.screen; // Ensure stage receives all events
    this.renderer.app.stage.on("pointerdown", this.boundPointerDown);
    this.renderer.app.stage.on("pointermove", this.boundPointerMove);
    this.renderer.app.stage.on("pointerup", this.boundPointerUp);
    this.renderer.app.stage.on("pointerupoutside", this.boundPointerUp);

    logger.info(
      `Stage hitArea set to: ${this.renderer.app.screen.width}x${this.renderer.app.screen.height}`,
    );

    // Add keyboard listener for Quest Journal
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener("keydown", this.boundKeyDown);

    // Add wheel listener for zoom (on window to ensure it captures events)
    this.boundWheel = this.onWheel.bind(this);
    window.addEventListener("wheel", this.boundWheel, { passive: false });

    // Prevent context menu on right click (used for panning)
    this.renderer.app.canvas.addEventListener("contextmenu", (e) =>
      e.preventDefault(),
    );

    logger.info(
      "SpaceFlightScene initialized with camera controls: pan (Shift+click), zoom (wheel)",
    );
  }

  update(deltaTime: number): void {
    this.updateStarField(deltaTime);
    this.updateShip(deltaTime);
    this.updatePlanets(deltaTime);
    this.updateTargetIndicator();
  }

  destroy(): void {
    // Remove all pointer event listeners
    if (this.boundPointerDown) {
      this.renderer.app.stage.off("pointerdown", this.boundPointerDown);
      this.boundPointerDown = null;
    }
    if (this.boundPointerMove) {
      this.renderer.app.stage.off("pointermove", this.boundPointerMove);
      this.boundPointerMove = null;
    }
    if (this.boundPointerUp) {
      this.renderer.app.stage.off("pointerup", this.boundPointerUp);
      this.renderer.app.stage.off("pointerupoutside", this.boundPointerUp);
      this.boundPointerUp = null;
    }

    // Remove keyboard listener
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }

    // Remove wheel listener
    if (this.boundWheel) {
      window.removeEventListener("wheel", this.boundWheel);
      this.boundWheel = null;
    }

    // Destroy planet sprites
    for (const sprite of this.planetSprites) {
      sprite.destroy();
    }
    this.planetSprites = [];

    // Destroy planet info panel
    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }

    // Destroy quest journal
    if (this.questJournalUI) {
      this.questJournalUI.destroy();
      this.questJournalUI = null;
    }

    // Destroy mini-map
    if (this.systemMiniMap) {
      this.systemMiniMap.destroy();
      this.systemMiniMap = null;
    }

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Reset the camera transform we applied to gameLayer. clearGameLayer only
    // removes children, not the scale/offset, so the next scene (PlanetScene,
    // StarMapScene) would otherwise inherit this scene's zoom/pan and render
    // scaled and shifted.
    if (this.renderer.gameLayer) {
      this.renderer.gameLayer.scale.set(1);
      this.renderer.gameLayer.x = 0;
      this.renderer.gameLayer.y = 0;
    }

    this.starLayers = [];
    this.shipContainer = null;
    this.shipGraphics = null;
    this.backgroundContainer = null;
    this.nebulaeContainer = null;
    this.uiContainer = null;
    this.cameraDebugText = null;
    this.dayCounterText = null;
    this.shipPhysics = null;
    this.starGraphics = null;
    this.orbitGraphics = null;
    this.distanceTraveled = 0;
    this.clearPlannedRoute(); // Clean up route line
    logger.info("SpaceFlightScene destroyed");
  }

  private createStarField(): void {
    if (!this.backgroundContainer) return;

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Simple star layers: count, parallax speed, size range, alpha range
    const layerConfigs = [
      { count: 600, speed: 0.01, size: [0.3, 0.8], alpha: [0.2, 0.4] },
      { count: 300, speed: 0.03, size: [0.6, 1.2], alpha: [0.3, 0.5] },
      { count: 100, speed: 0.06, size: [1.0, 2.0], alpha: [0.4, 0.6] },
    ];

    const starColors = [0xffffff, 0xaaccff, 0xffffcc, 0xffddaa, 0xddaaff];

    for (const config of layerConfigs) {
      const container = new Container();
      const stars: StarLayer["stars"] = [];

      for (let i = 0; i < config.count; i++) {
        const x = Math.random() * width * 2;
        const y = Math.random() * height * 2;
        const size =
          config.size[0] + Math.random() * (config.size[1] - config.size[0]);
        const alpha =
          config.alpha[0] + Math.random() * (config.alpha[1] - config.alpha[0]);

        stars.push({ x, y, size, alpha, speed: config.speed });

        const graphics = new Graphics();
        graphics.fill({
          color: starColors[Math.floor(Math.random() * starColors.length)],
          alpha,
        });
        graphics.circle(x, y, size);
        container.addChild(graphics);
      }

      this.starLayers.push({ container, stars, speed: config.speed });
      this.backgroundContainer.addChild(container); // Add to blurred background
    }
  }

  private createNebulae(): void {
    if (!this.backgroundContainer) return;

    this.nebulaeContainer = new Container();
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Simple nebula clouds with built-in blur
    const nebulae = [
      { x: width * 0.3, y: height * 0.3, r: 200, color: 0x4a0080, alpha: 0.08 },
      { x: width * 0.7, y: height * 0.6, r: 250, color: 0x006060, alpha: 0.06 },
      { x: width * 0.5, y: height * 0.5, r: 300, color: 0x8a60a0, alpha: 0.05 },
    ];

    for (const n of nebulae) {
      const g = new Graphics();
      g.fill({ color: n.color, alpha: n.alpha });
      g.circle(n.x, n.y, n.r);
      g.filters = [new BlurFilter({ strength: 20 })];
      this.nebulaeContainer.addChild(g);
    }

    // Add nebulae at the back of background container
    this.backgroundContainer.addChildAt(this.nebulaeContainer, 0);
  }

  /**
   * Create a beautiful star (sun) at the center of the system
   */
  private createStar(): void {
    this.starGraphics = new Graphics();

    // Draw multiple concentric circles for glow effect
    const glowLayers = [
      { radius: 60, color: 0xffff00, alpha: 0.1 },
      { radius: 50, color: 0xffdd00, alpha: 0.15 },
      { radius: 40, color: 0xffbb00, alpha: 0.2 },
      { radius: 32, color: 0xff9900, alpha: 0.3 },
    ];

    for (const layer of glowLayers) {
      this.starGraphics.circle(
        this.starCenterX,
        this.starCenterY,
        layer.radius,
      );
      this.starGraphics.fill({ color: layer.color, alpha: layer.alpha });
    }

    // Draw main star body
    this.starGraphics.circle(this.starCenterX, this.starCenterY, 28);
    this.starGraphics.fill({ color: 0xffaa00 });

    // Add bright core
    this.starGraphics.circle(this.starCenterX, this.starCenterY, 20);
    this.starGraphics.fill({ color: 0xffffaa });

    // Add white hot center
    this.starGraphics.circle(this.starCenterX, this.starCenterY, 12);
    this.starGraphics.fill({ color: 0xffffff, alpha: 0.9 });

    // Add subtle blur for atmospheric glow
    const blurFilter = new BlurFilter({ strength: 4 });
    this.starGraphics.filters = [blurFilter];

    // Add star to game layer (above nebulae, below planets)
    this.renderer.gameLayer.addChild(this.starGraphics);
  }

  /**
   * Draw visible orbital paths for planets
   */
  private createOrbits(): void {
    if (!this.gameEngine?.player) return;

    // Get current system
    const currentSystemId = this.gameEngine.player.currentSystemId;
    const galaxy = this.gameEngine.galaxy;
    if (!galaxy) return;

    const currentSystem = galaxy.systems.find((s) => s.id === currentSystemId);
    if (
      !currentSystem ||
      !currentSystem.planets ||
      currentSystem.planets.length === 0
    ) {
      return;
    }

    this.orbitGraphics = new Graphics();

    // Get unique orbital radii
    const uniqueRadii = new Set<number>();
    for (const planet of currentSystem.planets) {
      uniqueRadii.add(planet.orbitalRadius);
    }

    // Draw orbit circle for each unique radius
    for (const radius of uniqueRadii) {
      this.orbitGraphics.circle(this.starCenterX, this.starCenterY, radius);
      this.orbitGraphics.stroke({ color: 0x444444, width: 1, alpha: 0.3 });
    }

    // Add orbits to game layer (above star, below planets)
    this.renderer.gameLayer.addChild(this.orbitGraphics);
  }

  private createShip(): void {
    if (!this.shipPhysics) return;

    this.shipContainer = new Container();
    this.shipGraphics = new Graphics();

    // Draw ship body (triangle shape)
    this.drawShip();

    this.shipContainer.addChild(this.shipGraphics);
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.pivot.set(0, 0);

    this.renderer.gameLayer.addChild(this.shipContainer);
  }

  /**
   * Create target indicator (crosshair showing where ship is heading)
   */
  private createTargetIndicator(): void {
    this.targetIndicator = new Graphics();
    this.targetIndicator.visible = false; // Hidden by default
    this.renderer.gameLayer.addChild(this.targetIndicator);
  }

  /**
   * Update target indicator position and visibility
   */
  private updateTargetIndicator(): void {
    if (!this.targetIndicator || !this.shipPhysics) return;

    const distance = this.shipPhysics.getDistanceToTarget();

    // Show indicator only if ship is moving and target is far enough
    if (this.shipPhysics.isMoving && distance > 20) {
      this.targetIndicator.visible = true;
      this.targetIndicator.clear();

      // Draw pulsing crosshair at target position
      const targetX = this.shipPhysics.getTargetX();
      const targetY = this.shipPhysics.getTargetY();

      const size = 15;
      const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7; // Pulsing effect

      // Crosshair lines
      this.targetIndicator.moveTo(targetX - size, targetY);
      this.targetIndicator.lineTo(targetX + size, targetY);
      this.targetIndicator.moveTo(targetX, targetY - size);
      this.targetIndicator.lineTo(targetX, targetY + size);
      this.targetIndicator.stroke({ width: 2, color: 0x00ffff, alpha: pulse });

      // Center circle
      this.targetIndicator.circle(targetX, targetY, 4);
      this.targetIndicator.stroke({
        width: 1,
        color: 0x00ffff,
        alpha: pulse * 0.8,
      });
    } else {
      this.targetIndicator.visible = false;
    }
  }

  private drawShip(): void {
    if (!this.shipGraphics || !this.shipPhysics) return;
    this.shipGraphics.clear();

    const size = this.SHIP_SIZE;

    // Main hull
    this.shipGraphics
      .poly([
        size,
        0,
        -size * 0.7,
        -size * 0.6,
        -size * 0.4,
        0,
        -size * 0.7,
        size * 0.6,
      ])
      .fill({ color: 0x4488cc });

    // Cockpit
    this.shipGraphics
      .poly([
        size * 0.3,
        0,
        -size * 0.2,
        -size * 0.25,
        -size * 0.2,
        size * 0.25,
      ])
      .fill({ color: 0x88ccff });

    // Engine glow (visible when ship is moving)
    if (this.shipPhysics.isMoving) {
      this.shipGraphics
        .poly([
          -size * 0.5,
          -size * 0.3,
          -size * 0.5 - size * 0.5 * Math.random(),
          0,
          -size * 0.5,
          size * 0.3,
        ])
        .fill({ color: 0x00ffff, alpha: 0.6 });
    }

    // Engine lights
    this.shipGraphics.fill({ color: 0x00ffff, alpha: 0.8 });
    this.shipGraphics.circle(-size * 0.5, -size * 0.3, 2);
    this.shipGraphics.circle(-size * 0.5, size * 0.3, 2);
  }

  private createUI(): void {
    this.uiContainer = new Container();
    // Container uses default eventMode ('auto') - it won't block clicks since it has no handlers
    // Child elements with eventMode='static' will receive events

    // Instructions (non-interactive)
    const instructions = new Text({
      text: "ЛКМ - курс | Shift+ЛКМ/ПКМ - пан | Колесико - зум | [J] - Квесты | [I] - Инвентарь",
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fill: 0x88ccff,
      },
    });
    instructions.alpha = 0.8;
    instructions.x = 20;
    instructions.y = 20;
    instructions.eventMode = "none"; // Explicitly set to non-interactive
    this.uiContainer.addChild(instructions);

    // Camera debug display
    this.cameraDebugText = new Text({
      text: "Камера: Zoom 1.00 | Pan (0, 0)",
      style: {
        fontFamily: "Courier New",
        fontSize: 12,
        fill: 0xff00ff,
      },
    });
    this.cameraDebugText.x = this.renderer.app.screen.width - 300;
    this.cameraDebugText.y = this.renderer.app.screen.height - 30;
    this.cameraDebugText.eventMode = "none";
    this.uiContainer.addChild(this.cameraDebugText);

    // Current day display
    this.dayCounterText = new Text({
      text: `День: ${this.gameEngine?.galaxy?.gameDays ?? 0}`,
      style: { fontFamily: "Courier New", fontSize: 14, fill: 0x00ffff },
    });
    this.dayCounterText.x = 20;
    this.dayCounterText.y = 50;
    this.uiContainer.addChild(this.dayCounterText);

    // Quest Journal button
    const questBtn = new Text({
      text: "[КВЕСТЫ]",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    questBtn.x = 20;
    questBtn.y = 80;
    questBtn.eventMode = "static";
    questBtn.cursor = "pointer";
    questBtn.on("pointerdown", (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info("Quest journal button clicked");
      this.toggleQuestJournal();
    });
    questBtn.on("pointerover", () => {
      questBtn.alpha = 0.7;
    });
    questBtn.on("pointerout", () => {
      questBtn.alpha = 1;
    });
    this.uiContainer.addChild(questBtn);

    // Star map button
    const backBtn = new Text({
      text: "[МЕЖЗВЕЗДНАЯ КАРТА]",
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: "bold" as const,
      },
    });
    backBtn.x = this.renderer.app.screen.width - 220;
    backBtn.y = 20;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", async (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info("Star map button clicked");
      await this.returnToStarMap();
    });

    // Add hover effect
    backBtn.on("pointerover", () => {
      backBtn.alpha = 0.7;
    });
    backBtn.on("pointerout", () => {
      backBtn.alpha = 1;
    });

    this.uiContainer.addChild(backBtn);

    this.renderer.uiLayer.addChild(this.uiContainer);

    // Create mini-map
    this.systemMiniMap = new SystemMiniMap(
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );
    this.renderer.uiLayer.addChild(this.systemMiniMap.container);
  }

  /**
   * Create planet sprites for the current star system
   */
  private createPlanets(): void {
    if (!this.gameEngine?.player) return;

    // Get current system
    const currentSystemId = this.gameEngine.player.currentSystemId;
    const galaxy = this.gameEngine.galaxy;
    if (!galaxy) return;

    const currentSystem = galaxy.systems.find((s) => s.id === currentSystemId);
    if (
      !currentSystem ||
      !currentSystem.planets ||
      currentSystem.planets.length === 0
    ) {
      logger.debug("No planets in current system");
      return;
    }

    // Get quest objective locations
    const questLocations =
      this.gameEngine.questManager.getActiveQuestLocations();

    // Create sprite for each planet with random initial angle
    for (const planet of currentSystem.planets) {
      const initialAngle = Math.random() * Math.PI * 2;
      const sprite = new PlanetSprite(
        planet,
        this.starCenterX,
        this.starCenterY,
        initialAngle,
      );

      // Set up click handler
      sprite.createHitArea(this.onPlanetClick.bind(this));

      // Add quest marker if this planet is a quest objective
      if (questLocations.includes(planet.id)) {
        this.addQuestMarker(sprite);
      }

      // Add to game layer
      this.renderer.gameLayer.addChild(sprite.container);
      this.planetSprites.push(sprite);
    }

    logger.info(`Created ${this.planetSprites.length} planet sprites`);
  }

  /**
   * Add quest marker (pulsing ring) to a planet sprite
   */
  private addQuestMarker(sprite: PlanetSprite): void {
    const marker = new Graphics();

    // Draw pulsing ring around planet
    const radius = 25; // Slightly larger than planet
    marker.circle(0, 0, radius);
    marker.stroke({ width: 3, color: 0xffff00, alpha: 0.8 });

    // Add to planet container so it rotates with planet
    sprite.container.addChild(marker);

    logger.debug(`Added quest marker to planet ${sprite.planet.name}`);
  }

  /**
   * Handle planet click: two-step movement - plan route on first click, execute on second
   */
  private onPlanetClick(planet: Planet): void {
    logger.debug(`Planet clicked: ${planet.name}`);

    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === planet.id,
    );
    if (!planetSprite || !this.shipPhysics) return;

    // Two-step movement logic
    if (this.plannedRoute) {
      // Check if clicking on the same planet (within 50px of planned route)
      const dx = planetSprite.screenX - this.plannedRoute.x;
      const dy = planetSprite.screenY - this.plannedRoute.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 50) {
        // Second click - execute the route
        this.shipPhysics.setTarget(this.plannedRoute.x, this.plannedRoute.y);
        logger.info(`▶️ Executing route to planet ${planet.name}`);
      } else {
        // Different planet - update planned route
        this.plannedRoute = {
          x: planetSprite.screenX,
          y: planetSprite.screenY,
        };
        this.drawRouteLine();
        logger.info(`🗺️ Route updated to planet ${planet.name}`);
      }
    } else {
      // First click - plan the route
      this.plannedRoute = { x: planetSprite.screenX, y: planetSprite.screenY };
      this.drawRouteLine();
      logger.info(
        `🗺️ Route planned to planet ${planet.name}. Click again to execute.`,
      );
    }

    // Show planet info panel. Landing is only offered once the ship has
    // actually flown to the planet; otherwise a single click would teleport the
    // player there (game-days only accrue while the ship is in motion).
    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }

    const distanceX = planetSprite.screenX - this.shipPhysics.shipX;
    const distanceY = planetSprite.screenY - this.shipPhysics.shipY;
    const distanceToPlanet = Math.sqrt(
      distanceX * distanceX + distanceY * distanceY,
    );
    const flightDays = Math.max(
      1,
      Math.ceil(distanceToPlanet / this.DISTANCE_PER_DAY),
    );
    const shipAtPlanet = distanceToPlanet <= this.LANDING_RANGE;

    this.planetInfoPanel = new PlanetInfoPanel(
      planet,
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
      flightDays,
      shipAtPlanet ? () => this.onLandOnPlanet(planet) : undefined,
    );
    this.renderer.uiLayer.addChild(this.planetInfoPanel.container);
  }

  private async onLandOnPlanet(planet: Planet): Promise<void> {
    // Guard: only allow landing when the ship has actually reached the planet.
    // Game-days already accrue during the flight (see updateShip), so we do NOT
    // simulate flightDays here — doing so previously let a single click both
    // teleport the player and skip days for free.
    const sprite = this.planetSprites.find((s) => s.planet.id === planet.id);
    if (sprite && this.shipPhysics) {
      const dx = sprite.screenX - this.shipPhysics.shipX;
      const dy = sprite.screenY - this.shipPhysics.shipY;
      if (Math.sqrt(dx * dx + dy * dy) > this.LANDING_RANGE) {
        logger.warn("Cannot land: ship has not reached the planet yet");
        return;
      }
    }

    if (this.gameEngine?.player?.ship) {
      this.gameEngine.player.ship.energy =
        this.gameEngine.player.ship.maxEnergy;
    }
    await this.gameEngine?.transitionTo(SceneType.PLANET, {
      gameEngine: this.gameEngine,
      planet,
    });
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.shipPhysics) return;

    logger.info(
      `🖱️ POINTER DOWN: button=${event.button}, shift=${event.shiftKey}, global=(${event.global.x.toFixed(0)}, ${event.global.y.toFixed(0)})`,
    );

    // Middle mouse button (1), right button (2), or Shift+Left for panning
    const isPanButton =
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && event.shiftKey);

    if (isPanButton) {
      event.preventDefault(); // Prevent default behavior for pan buttons
      this.isPanning = true;
      this.lastPanX = event.global.x;
      this.lastPanY = event.global.y;
      logger.info(`✅ Pan mode activated with button ${event.button}`);
      return;
    }

    // Left button (0) for ship navigation (only if not holding Shift)
    // Two-step movement: first click plans route, second click executes
    if (event.button === 0 && !event.shiftKey) {
      // Convert screen coordinates to world coordinates
      const world = this.screenToWorld(event.global.x, event.global.y);

      // Check if we already have a planned route
      if (this.plannedRoute) {
        // Check if clicking near the same point (within 50px) - execute the route
        const dx = world.x - this.plannedRoute.x;
        const dy = world.y - this.plannedRoute.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 50) {
          // Execute planned route
          this.shipPhysics.setTarget(this.plannedRoute.x, this.plannedRoute.y);
          logger.info(
            `▶️ Executing planned route to (${this.plannedRoute.x.toFixed(0)}, ${this.plannedRoute.y.toFixed(0)})`,
          );
          // Keep the route line visible during movement
        } else {
          // Clicked on different location - update planned route
          this.plannedRoute = { x: world.x, y: world.y };
          this.drawRouteLine();
          logger.info(
            `🗺️ Route updated to (${world.x.toFixed(0)}, ${world.y.toFixed(0)})`,
          );
        }
      } else {
        // First click - plan the route (don't start moving yet)
        this.plannedRoute = { x: world.x, y: world.y };
        this.drawRouteLine();
        logger.info(
          `🗺️ Route planned to (${world.x.toFixed(0)}, ${world.y.toFixed(0)}). Click again to execute.`,
        );
      }
    }
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    // Handle camera panning
    if (this.isPanning) {
      const dx = event.global.x - this.lastPanX;
      const dy = event.global.y - this.lastPanY;
      this.cameraPanX += dx;
      this.cameraPanY += dy;
      this.lastPanX = event.global.x;
      this.lastPanY = event.global.y;
      this.applyCameraTransform();
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        logger.info(
          `📍 Camera pan: (${this.cameraPanX.toFixed(0)}, ${this.cameraPanY.toFixed(0)})`,
        );
      }
      return;
    }

    // No more drag-to-update target in two-step mode
    // Route is fixed once planned, can only be updated by clicking
  }

  private onPointerUp(): void {
    if (this.isPanning) {
      logger.info("❌ Pan mode deactivated");
    }
    this.isPanning = false;
  }

  /**
   * Handle mouse wheel for zoom
   */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    logger.info(`🔍 WHEEL EVENT FIRED! deltaY: ${event.deltaY}`);

    const oldZoom = this.cameraZoom;

    // Calculate zoom delta (negative deltaY = zoom in, positive = zoom out)
    const zoomDelta = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = this.cameraZoom * zoomDelta;

    // Clamp zoom to min/max bounds
    const clampedZoom = Math.max(
      this.MIN_ZOOM,
      Math.min(this.MAX_ZOOM, newZoom),
    );

    // Zoom towards screen center to keep it fixed
    // Formula: adjust pan so that the center point in world space stays at the same screen position
    const screenCenterX = this.renderer.app.screen.width / 2;
    const screenCenterY = this.renderer.app.screen.height / 2;

    // World coordinates of the center point before zoom
    const worldCenterX = (screenCenterX - this.cameraPanX) / this.cameraZoom;
    const worldCenterY = (screenCenterY - this.cameraPanY) / this.cameraZoom;

    // Update zoom
    this.cameraZoom = clampedZoom;

    // Adjust pan to keep the world center at the same screen position
    this.cameraPanX = screenCenterX - worldCenterX * this.cameraZoom;
    this.cameraPanY = screenCenterY - worldCenterY * this.cameraZoom;

    this.applyCameraTransform();
    logger.info(
      `Camera zoom: ${oldZoom.toFixed(2)} → ${this.cameraZoom.toFixed(2)} (deltaY: ${event.deltaY})`,
    );
  }

  /**
   * Apply camera zoom and pan to game layer
   */
  private applyCameraTransform(): void {
    if (!this.renderer.gameLayer) return;

    // Apply scale
    this.renderer.gameLayer.scale.set(this.cameraZoom);

    // Apply position offset
    this.renderer.gameLayer.x = this.cameraPanX;
    this.renderer.gameLayer.y = this.cameraPanY;

    // Update debug display
    this.updateCameraDebugDisplay();
  }

  /**
   * Update camera debug text display
   */
  private updateCameraDebugDisplay(): void {
    if (this.cameraDebugText) {
      this.cameraDebugText.text = `Камера: Zoom ${this.cameraZoom.toFixed(2)} | Pan (${this.cameraPanX.toFixed(0)}, ${this.cameraPanY.toFixed(0)})`;
    }
  }

  /**
   * Convert screen coordinates to world coordinates (accounting for camera transform)
   */
  private screenToWorld(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const worldX = (screenX - this.cameraPanX) / this.cameraZoom;
    const worldY = (screenY - this.cameraPanY) / this.cameraZoom;
    return { x: worldX, y: worldY };
  }

  private updateShip(deltaTime: number): void {
    if (!this.shipContainer || !this.shipGraphics || !this.shipPhysics) return;

    // Track position before update (for distance calculation)
    const prevX = this.shipPhysics.shipX;
    const prevY = this.shipPhysics.shipY;
    const wasMoving = this.shipPhysics.isMoving;

    // Update physics
    this.shipPhysics.update(deltaTime);

    // Check if ship just arrived (was moving, now stopped)
    if (wasMoving && !this.shipPhysics.isMoving) {
      logger.info("🎯 Ship arrived at destination. Clearing planned route.");
      this.clearPlannedRoute();
    }

    // Turn-based time: only advance days when ship is moving
    if (this.shipPhysics.isMoving && this.shipPhysics.currentSpeed > 0.01) {
      const dx = this.shipPhysics.shipX - prevX;
      const dy = this.shipPhysics.shipY - prevY;
      const distanceMoved = Math.sqrt(dx * dx + dy * dy);

      this.distanceTraveled += distanceMoved;

      // Every DISTANCE_PER_DAY pixels = 1 game day
      while (this.distanceTraveled >= this.DISTANCE_PER_DAY) {
        this.distanceTraveled -= this.DISTANCE_PER_DAY;
        if (this.gameEngine?.galaxy) {
          this.gameEngine.galaxy.simulateDay();
          this.updateDayCounter(); // Update UI

          // Check for expired quests after each day
          if (this.gameEngine.player) {
            this.gameEngine.questManager.checkExpiredQuests(
              this.gameEngine.galaxy.gameDays,
              this.gameEngine.player,
            );
          }

          logger.debug(
            `Day passed during flight. Current day: ${this.gameEngine.galaxy.gameDays}`,
          );
        }
      }
    }

    // Read updated values from physics
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.rotation = this.shipPhysics.shipAngle;

    // Redraw ship for engine effects (uses isMoving from physics)
    this.drawShip();
  }

  /**
   * Update day counter UI text
   */
  private updateDayCounter(): void {
    if (this.dayCounterText && this.gameEngine?.galaxy) {
      this.dayCounterText.text = `День: ${this.gameEngine.galaxy.gameDays}`;
    }
  }

  /**
   * Draw planned route line from ship to target
   */
  private drawRouteLine(): void {
    if (!this.shipPhysics || !this.plannedRoute) return;

    // Remove old route line
    if (this.routeLineGraphics) {
      this.renderer.gameLayer.removeChild(this.routeLineGraphics);
      this.routeLineGraphics.destroy();
    }

    // Create new route line
    this.routeLineGraphics = new Graphics();

    // Dashed line from ship to target
    const fromX = this.shipPhysics.shipX;
    const fromY = this.shipPhysics.shipY;
    const toX = this.plannedRoute.x;
    const toY = this.plannedRoute.y;

    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dashLength = 20;
    const gapLength = 10;
    const totalLength = dashLength + gapLength;
    const numSegments = Math.floor(distance / totalLength);

    this.routeLineGraphics.moveTo(fromX, fromY);

    for (let i = 0; i < numSegments; i++) {
      const t1 = (i * totalLength) / distance;
      const t2 = (i * totalLength + dashLength) / distance;

      const x1 = fromX + dx * t1;
      const y1 = fromY + dy * t1;
      const x2 = fromX + dx * t2;
      const y2 = fromY + dy * t2;

      this.routeLineGraphics.moveTo(x1, y1);
      this.routeLineGraphics.lineTo(x2, y2);
    }

    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.6 });

    // Check if route target is near a planet (within 50px radius)
    const isLandingOnPlanet = this.planetSprites.some((sprite) => {
      const pdx = sprite.screenX - toX;
      const pdy = sprite.screenY - toY;
      const planetDistance = Math.sqrt(pdx * pdx + pdy * pdy);
      return planetDistance < 50; // Within planet interaction radius
    });

    // Draw different marker based on whether this is a landing or empty space navigation
    if (isLandingOnPlanet) {
      // Landing marker: downward arrow + landing circles
      this.drawLandingMarker(toX, toY);
    } else {
      // Navigation marker: simple pulsing circle
      this.drawNavigationMarker(toX, toY);
    }

    this.renderer.gameLayer.addChild(this.routeLineGraphics);
  }

  /**
   * Draw landing marker for planetary approach
   */
  private drawLandingMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    // Outer landing zone circles
    this.routeLineGraphics.circle(x, y, 25);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 3, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 30);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 2, alpha: 0.4 });

    // Downward arrow (landing symbol)
    const arrowSize = 15;
    const arrowWidth = 8;

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
    this.routeLineGraphics.moveTo(x - 12, y + arrowSize + 5);
    this.routeLineGraphics.lineTo(x + 12, y + arrowSize + 5);
    this.routeLineGraphics.stroke({ color: 0xff9900, width: 2, alpha: 0.7 });
  }

  /**
   * Draw navigation marker for empty space movement
   */
  private drawNavigationMarker(x: number, y: number): void {
    if (!this.routeLineGraphics) return;

    // Pulsing circles for generic navigation target
    this.routeLineGraphics.circle(x, y, 15);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 3, alpha: 0.8 });
    this.routeLineGraphics.circle(x, y, 20);
    this.routeLineGraphics.stroke({ color: 0x00ffff, width: 2, alpha: 0.4 });
  }

  /**
   * Clear planned route and route line
   */
  private clearPlannedRoute(): void {
    this.plannedRoute = null;

    if (this.routeLineGraphics) {
      this.renderer.gameLayer.removeChild(this.routeLineGraphics);
      this.routeLineGraphics.destroy();
      this.routeLineGraphics = null;
    }
  }

  /**
   * Update planet positions for orbital rotation and mini-map
   * Turn-based: planets only rotate when ship is moving
   */
  private updatePlanets(deltaTime: number): void {
    // Turn-based gameplay: only update planets when ship is moving
    const isShipMoving =
      this.shipPhysics?.isMoving && this.shipPhysics.currentSpeed > 0.01;

    if (isShipMoving) {
      for (const sprite of this.planetSprites) {
        sprite.update(deltaTime);
      }
    }

    // Always update mini-map (even when paused, for visual feedback)
    if (this.systemMiniMap && this.shipPhysics) {
      this.systemMiniMap.updateWithSprites(
        this.planetSprites,
        this.shipPhysics.shipX,
        this.shipPhysics.shipY,
        this.starCenterX,
        this.starCenterY,
      );
    }
  }

  private updateStarField(deltaTime: number): void {
    if (!this.shipPhysics) return;

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Calculate velocity vector from ship's current speed and angle
    const velocityX =
      Math.cos(this.shipPhysics.shipAngle) * this.shipPhysics.currentSpeed;
    const velocityY =
      Math.sin(this.shipPhysics.shipAngle) * this.shipPhysics.currentSpeed;

    for (const layer of this.starLayers) {
      // Move stars opposite to ship movement for parallax effect
      const offsetX = -velocityX * layer.speed * deltaTime * 10;
      const offsetY = -velocityY * layer.speed * deltaTime * 10;

      layer.container.x += offsetX;
      layer.container.y += offsetY;

      // Wrap around
      if (layer.container.x < -width) layer.container.x += width;
      if (layer.container.x > width) layer.container.x -= width;
      if (layer.container.y < -height) layer.container.y += height;
      if (layer.container.y > height) layer.container.y -= height;
    }
  }

  private async returnToStarMap(): Promise<void> {
    logger.info("Returning to star map");
    if (this.gameEngine) {
      await this.gameEngine.transitionTo(SceneType.STAR_MAP);
    }
  }

  /**
   * Handle keyboard input (J key for quest journal)
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "j" || event.key === "J") {
      this.toggleQuestJournal();
    } else if (event.key === "i" || event.key === "I") {
      this.openInventory();
    }
  }

  /**
   * Toggle quest journal UI
   */
  private toggleQuestJournal(): void {
    if (this.questJournalUI) {
      // Close journal
      this.questJournalUI.destroy();
      this.questJournalUI = null;
      logger.info("Quest journal closed");
    } else {
      // Open journal
      if (this.gameEngine?.questManager) {
        this.questJournalUI = new QuestJournalUI(
          this.gameEngine.questManager,
          this.renderer.app.screen.width,
          this.renderer.app.screen.height,
          () => {
            this.questJournalUI?.destroy();
            this.questJournalUI = null;
          },
          (locationId: string) => this.navigateToQuestObjective(locationId),
        );
        this.renderer.uiLayer.addChild(this.questJournalUI.container);
        logger.info("Quest journal opened");
      }
    }
  }

  /**
   * Open inventory scene
   */
  private async openInventory(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info("Opening inventory");
    await this.gameEngine.transitionTo("INVENTORY" as any, {
      gameEngine: this.gameEngine,
    });
  }

  /**
   * Navigate ship to quest objective location (planet)
   */
  private navigateToQuestObjective(locationId: string): void {
    logger.info(`Navigating to quest objective: ${locationId}`);

    // Find planet sprite by locationId
    const planetSprite = this.planetSprites.find(
      (s) => s.planet.id === locationId,
    );
    if (planetSprite && this.shipPhysics) {
      // Set ship target to planet
      this.shipPhysics.setTarget(planetSprite.screenX, planetSprite.screenY);
      logger.info(
        `Set navigation target to planet ${planetSprite.planet.name}`,
      );

      // Show planet info panel
      this.onPlanetClick(planetSprite.planet);
    } else {
      logger.warn(`Could not find planet with ID: ${locationId}`);
    }
  }

  /** E2E helper: click back to star map */
  async e2eClickBackToMap(): Promise<void> {
    await this.returnToStarMap();
  }

  /** E2E helper: set ship target position */
  e2eSetTarget(x: number, y: number): void {
    if (this.shipPhysics) {
      this.shipPhysics.setTarget(x, y);
    }
  }

  /** E2E helper: get camera state */
  e2eGetCameraState(): { zoom: number; panX: number; panY: number } {
    return {
      zoom: this.cameraZoom,
      panX: this.cameraPanX,
      panY: this.cameraPanY,
    };
  }

  /** E2E helper: set camera zoom */
  e2eSetCameraZoom(zoom: number): void {
    this.cameraZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, zoom));
    this.applyCameraTransform();
  }

  /** E2E helper: set camera pan */
  e2eSetCameraPan(x: number, y: number): void {
    this.cameraPanX = x;
    this.cameraPanY = y;
    this.applyCameraTransform();
  }

  /** E2E helper: check if minimap exists */
  e2eHasMinimap(): boolean {
    return this.systemMiniMap !== null;
  }

  /** E2E helper: get ship position */
  e2eGetShipPosition(): { x: number; y: number } {
    return {
      x: this.shipPhysics?.shipX ?? 0,
      y: this.shipPhysics?.shipY ?? 0,
    };
  }

  /** E2E helper: check if quest journal is open */
  e2eIsQuestJournalOpen(): boolean {
    return (
      this.questJournalUI !== null && this.questJournalUI.container.visible
    );
  }
}
