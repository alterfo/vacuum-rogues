import { GameScene } from './GameScene';
import { Graphics, Text, Container, FederatedPointerEvent, BlurFilter } from 'pixi.js';
import type { GameEngine } from '@/systems/GameEngine';
import { SceneType } from '@/types';
import { PlanetSprite } from './PlanetSprite';
import { PlanetInfoPanel } from './PlanetInfoPanel';
import type { Planet } from '@/domain/Planet';
import { logger } from '@/utils/logger';

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
    this.maxSpeed = maxSpeed ?? 0.3; // pixels/ms - default cruising speed
    // Calculate rotation speed: 90° (π/2 rad) in 300ms = 5.24 rad/s = 0.00524 rad/ms
    this.rotationSpeed = (Math.PI / 2) / 300;
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

    // Calculate stopping distance: v² / (2a)
    const stoppingDistance = (this.currentSpeed * this.currentSpeed) / (2 * this.deceleration);

    // Speed update: accelerate if far from target, decelerate when approaching
    if (distance > stoppingDistance && this.currentSpeed < this.maxSpeed) {
      // Acceleration phase
      this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.acceleration * dt);
    } else if (distance <= stoppingDistance && this.currentSpeed > 0) {
      // Deceleration phase
      this.currentSpeed = Math.max(0, this.currentSpeed - this.deceleration * dt);
    }
    // Else: cruise phase (maintain current speed)

    // Rotation update
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

    // Position update
    const moveDistance = this.currentSpeed * dt;
    this.shipX += Math.cos(this.shipAngle) * moveDistance;
    this.shipY += Math.sin(this.shipAngle) * moveDistance;
  }
}

export class SpaceFlightScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private shipContainer: Container | null = null;
  private shipGraphics: Graphics | null = null;
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

  // Continuous input tracking
  private isPointerDown: boolean = false;
  private boundPointerDown: ((event: FederatedPointerEvent) => void) | null = null;
  private boundPointerMove: ((event: FederatedPointerEvent) => void) | null = null;
  private boundPointerUp: (() => void) | null = null;

  initialize(context?: object): void {
    this.gameEngine = (context as { gameEngine?: GameEngine })?.gameEngine ?? null;

    // Initialize ship physics with center position and optional speed from PlayerShip
    const centerX = this.renderer.app.screen.width / 2;
    const centerY = this.renderer.app.screen.height / 2;
    const maxSpeed = this.gameEngine?.player?.ship.speed ?? undefined;
    this.shipPhysics = new ShipPhysics(centerX, centerY, maxSpeed);

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Calculate star center position (screen center)
    this.starCenterX = this.renderer.app.screen.width / 2;
    this.starCenterY = this.renderer.app.screen.height / 2;

    this.createStarField();
    this.createNebulae();
    this.createPlanets();
    this.createShip();
    this.createUI();

    // Enable interactivity on stage for continuous pointer tracking
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.renderer.app.stage.eventMode = 'static';
    this.renderer.app.stage.on('pointerdown', this.boundPointerDown);
    this.renderer.app.stage.on('pointermove', this.boundPointerMove);
    this.renderer.app.stage.on('pointerup', this.boundPointerUp);
    this.renderer.app.stage.on('pointerupoutside', this.boundPointerUp);

    logger.info('SpaceFlightScene initialized');
  }

  update(deltaTime: number): void {
    this.updateStarField(deltaTime);
    this.updateShip(deltaTime);
  }

  destroy(): void {
    // Remove all pointer event listeners
    if (this.boundPointerDown) {
      this.renderer.app.stage.off('pointerdown', this.boundPointerDown);
      this.boundPointerDown = null;
    }
    if (this.boundPointerMove) {
      this.renderer.app.stage.off('pointermove', this.boundPointerMove);
      this.boundPointerMove = null;
    }
    if (this.boundPointerUp) {
      this.renderer.app.stage.off('pointerup', this.boundPointerUp);
      this.renderer.app.stage.off('pointerupoutside', this.boundPointerUp);
      this.boundPointerUp = null;
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

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.starLayers = [];
    this.shipContainer = null;
    this.shipGraphics = null;
    this.nebulaeContainer = null;
    this.uiContainer = null;
    this.shipPhysics = null;
    logger.info('SpaceFlightScene destroyed');
  }

  private createStarField(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Create 3 parallax layers
    const layerConfigs = [
      { count: 150, speed: 0.02, sizeRange: [0.5, 1.5], alphaRange: [0.3, 0.7] },
      { count: 80, speed: 0.05, sizeRange: [1, 2.5], alphaRange: [0.5, 0.9] },
      { count: 30, speed: 0.1, sizeRange: [2, 4], alphaRange: [0.7, 1.0] },
    ];

    for (const config of layerConfigs) {
      const container = new Container();
      const stars: StarLayer['stars'] = [];

      for (let i = 0; i < config.count; i++) {
        const star = {
          x: Math.random() * width,
          y: Math.random() * height,
          size: config.sizeRange[0] + Math.random() * (config.sizeRange[1] - config.sizeRange[0]),
          alpha: config.alphaRange[0] + Math.random() * (config.alphaRange[1] - config.alphaRange[0]),
          speed: config.speed,
        };
        stars.push(star);

        const graphics = new Graphics();
        graphics.fill({ color: 0xffffff, alpha: star.alpha });
        graphics.circle(star.x, star.y, star.size);
        container.addChild(graphics);
      }

      this.starLayers.push({ container, stars, speed: config.speed });
      this.renderer.gameLayer.addChild(container);
    }
  }

  private createNebulae(): void {
    this.nebulaeContainer = new Container();
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Create 3 nebula clouds
    const nebulae = [
      { x: width * 0.2, y: height * 0.3, color: 0x4a0080, radius: 200, alpha: 0.15 },
      { x: width * 0.7, y: height * 0.6, color: 0x008060, radius: 250, alpha: 0.12 },
      { x: width * 0.5, y: height * 0.8, color: 0x802000, radius: 180, alpha: 0.1 },
    ];

    for (const nebula of nebulae) {
      const graphics = new Graphics();
      graphics.fill({ color: nebula.color, alpha: nebula.alpha });
      graphics.circle(nebula.x, nebula.y, nebula.radius);

      // Add blur effect for soft nebula look
      const blurFilter = new BlurFilter({ strength: 8 });
      graphics.filters = [blurFilter];

      this.nebulaeContainer.addChild(graphics);
    }

    this.renderer.gameLayer.addChildAt(this.nebulaeContainer, 0);
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

  private drawShip(): void {
    if (!this.shipGraphics || !this.shipPhysics) return;
    this.shipGraphics.clear();

    const size = this.SHIP_SIZE;

    // Main hull
    this.shipGraphics
      .poly([size, 0, -size * 0.7, -size * 0.6, -size * 0.4, 0, -size * 0.7, size * 0.6])
      .fill({ color: 0x4488cc });

    // Cockpit
    this.shipGraphics
      .poly([size * 0.3, 0, -size * 0.2, -size * 0.25, -size * 0.2, size * 0.25])
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
    this.uiContainer.eventMode = 'static';

    // Instructions
    const instructions = new Text({
      text: 'Кликните, чтобы переместить корабль',
      style: {
        fontFamily: 'Courier New',
        fontSize: 14,
        fill: 0x88ccff,
      },
    });
    instructions.alpha = 0.8;
    instructions.x = 20;
    instructions.y = 20;
    this.uiContainer.addChild(instructions);

    // Back button with hit area
    const backBtn = new Text({
      text: '[НАЗАД К КАРТЕ]',
      style: {
        fontFamily: 'Courier New',
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: 'bold' as const,
      },
    });
    backBtn.x = this.renderer.app.screen.width - 180;
    backBtn.y = 20;
    backBtn.eventMode = 'static';
    backBtn.cursor = 'pointer';
    backBtn.on('pointerdown', async () => {
      logger.info('Back to map clicked');
      await this.returnToStarMap();
    });

    // Add hover effect
    backBtn.on('pointerover', () => { backBtn.alpha = 0.7; });
    backBtn.on('pointerout', () => { backBtn.alpha = 1; });

    this.uiContainer.addChild(backBtn);

    this.renderer.uiLayer.addChild(this.uiContainer);
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
    if (!currentSystem || !currentSystem.planets || currentSystem.planets.length === 0) {
      logger.debug('No planets in current system');
      return;
    }

    // Create sprite for each planet with random initial angle
    for (const planet of currentSystem.planets) {
      const initialAngle = Math.random() * Math.PI * 2;
      const sprite = new PlanetSprite(planet, this.starCenterX, this.starCenterY, initialAngle);

      // Set up click handler
      sprite.createHitArea(this.onPlanetClick.bind(this));

      // Add to game layer
      this.renderer.gameLayer.addChild(sprite.container);
      this.planetSprites.push(sprite);
    }

    logger.info(`Created ${this.planetSprites.length} planet sprites`);
  }

  /**
   * Handle planet click: show info panel and navigate ship to planet
   */
  private onPlanetClick(planet: Planet): void {
    logger.debug(`Planet clicked: ${planet.name}`);

    // Close existing info panel
    if (this.planetInfoPanel) {
      this.planetInfoPanel.destroy();
      this.planetInfoPanel = null;
    }

    // Create new info panel
    this.planetInfoPanel = new PlanetInfoPanel(
      planet,
      this.renderer.app.screen.width,
      this.renderer.app.screen.height,
    );
    this.renderer.uiLayer.addChild(this.planetInfoPanel.container);

    // Find planet sprite to get screen coordinates
    const planetSprite = this.planetSprites.find((s) => s.planet.id === planet.id);
    if (planetSprite && this.shipPhysics) {
      this.shipPhysics.setTarget(planetSprite.screenX, planetSprite.screenY);
    }
  }

  private onPointerDown(event: FederatedPointerEvent): void {
    if (!this.shipPhysics) return;
    this.isPointerDown = true;
    this.shipPhysics.setTarget(event.global.x, event.global.y);
    logger.debug(`Ship target set to: ${event.global.x}, ${event.global.y}`);
  }

  private onPointerMove(event: FederatedPointerEvent): void {
    if (!this.isPointerDown || !this.shipPhysics) return;
    this.shipPhysics.setTarget(event.global.x, event.global.y);
  }

  private onPointerUp(): void {
    this.isPointerDown = false;
  }

  private updateShip(deltaTime: number): void {
    if (!this.shipContainer || !this.shipGraphics || !this.shipPhysics) return;

    // Update physics
    this.shipPhysics.update(deltaTime);

    // Read updated values from physics
    this.shipContainer.x = this.shipPhysics.shipX;
    this.shipContainer.y = this.shipPhysics.shipY;
    this.shipContainer.rotation = this.shipPhysics.shipAngle;

    // Redraw ship for engine effects (uses isMoving from physics)
    this.drawShip();
  }

  private updateStarField(deltaTime: number): void {
    if (!this.shipPhysics) return;

    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Calculate velocity vector from ship's current speed and angle
    const velocityX = Math.cos(this.shipPhysics.shipAngle) * this.shipPhysics.currentSpeed;
    const velocityY = Math.sin(this.shipPhysics.shipAngle) * this.shipPhysics.currentSpeed;

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
    logger.info('Returning to star map');
    if (this.gameEngine) {
      await this.gameEngine.transitionTo(SceneType.STAR_MAP);
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
}
