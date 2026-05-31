import { GameScene } from './GameScene';
import { Graphics, Text, Container, FederatedPointerEvent, BlurFilter } from 'pixi.js';
import type { GameEngine } from '@/systems/GameEngine';
import { SceneType } from '@/types';
import { PlanetSprite } from './PlanetSprite';
import { PlanetInfoPanel } from './PlanetInfoPanel';
import { SystemMiniMap } from './SystemMiniMap';
import { QuestJournalUI } from './QuestJournalUI';
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
    const stoppingDistance = (this.currentSpeed * this.currentSpeed) / (2 * this.deceleration);

    // Speed update: accelerate if far from target and aligned, decelerate when approaching
    if (distance > stoppingDistance && this.currentSpeed < this.maxSpeed && isAligned) {
      // Acceleration phase - only when pointing at target
      this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.acceleration * dt);
    } else if (distance <= stoppingDistance && this.currentSpeed > 0) {
      // Deceleration phase
      this.currentSpeed = Math.max(0, this.currentSpeed - this.deceleration * dt);
    } else if (!isAligned && this.currentSpeed > this.maxSpeed * 0.3) {
      // Slow down if not aligned and going too fast
      this.currentSpeed = Math.max(this.maxSpeed * 0.3, this.currentSpeed - this.deceleration * dt * 0.5);
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

  // Continuous input tracking
  private isPointerDown: boolean = false;
  private boundPointerDown: ((event: FederatedPointerEvent) => void) | null = null;
  private boundPointerMove: ((event: FederatedPointerEvent) => void) | null = null;
  private boundPointerUp: (() => void) | null = null;
  private boundKeyDown: ((event: KeyboardEvent) => void) | null = null;

  initialize(context?: object): void {
    this.gameEngine = (context as { gameEngine?: GameEngine })?.gameEngine ?? null;

    // Calculate star center position (screen center)
    const centerX = this.renderer.app.screen.width / 2;
    const centerY = this.renderer.app.screen.height / 2;

    // Initialize ship physics at system entry point (bottom-right edge)
    // Entry point is beyond the outermost orbit
    const entryX = centerX + 600; // Right side, beyond furthest orbit (550px)
    const entryY = centerY + 400; // Below center
    const maxSpeed = this.gameEngine?.player?.ship.speed ?? undefined;
    this.shipPhysics = new ShipPhysics(entryX, entryY, maxSpeed);

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Store star center position
    this.starCenterX = centerX;
    this.starCenterY = centerY;

    this.createStarField();
    this.createNebulae();
    this.createStar();
    this.createOrbits();
    this.createPlanets();
    this.createShip();
    this.createTargetIndicator();
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

    // Add keyboard listener for Quest Journal
    this.boundKeyDown = this.onKeyDown.bind(this);
    window.addEventListener('keydown', this.boundKeyDown);

    logger.info('SpaceFlightScene initialized');
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

    // Remove keyboard listener
    if (this.boundKeyDown) {
      window.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
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
    this.starLayers = [];
    this.shipContainer = null;
    this.shipGraphics = null;
    this.nebulaeContainer = null;
    this.uiContainer = null;
    this.shipPhysics = null;
    this.starGraphics = null;
    this.orbitGraphics = null;
    logger.info('SpaceFlightScene destroyed');
  }

  private createStarField(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Create 3 parallax layers with more stars and variety
    const layerConfigs = [
      { count: 300, speed: 0.02, sizeRange: [0.5, 1.5], alphaRange: [0.3, 0.7] },
      { count: 150, speed: 0.05, sizeRange: [1, 2.5], alphaRange: [0.5, 0.9] },
      { count: 50, speed: 0.1, sizeRange: [2, 4], alphaRange: [0.7, 1.0] },
    ];

    // Star colors (white, blue-white, yellow-white)
    const starColors = [0xffffff, 0xaaccff, 0xffffaa, 0xffdddd];

    for (const config of layerConfigs) {
      const container = new Container();
      const stars: StarLayer['stars'] = [];

      for (let i = 0; i < config.count; i++) {
        const star = {
          x: Math.random() * width * 2, // Wider area for wrap-around
          y: Math.random() * height * 2,
          size: config.sizeRange[0] + Math.random() * (config.sizeRange[1] - config.sizeRange[0]),
          alpha: config.alphaRange[0] + Math.random() * (config.alphaRange[1] - config.alphaRange[0]),
          speed: config.speed,
        };
        stars.push(star);

        const graphics = new Graphics();
        const starColor = starColors[Math.floor(Math.random() * starColors.length)];
        graphics.fill({ color: starColor, alpha: star.alpha });
        graphics.circle(star.x, star.y, star.size);

        // Add subtle glow for larger stars
        if (star.size > 2) {
          graphics.fill({ color: starColor, alpha: star.alpha * 0.3 });
          graphics.circle(star.x, star.y, star.size * 1.5);
        }

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
      this.starGraphics.circle(this.starCenterX, this.starCenterY, layer.radius);
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
    if (!currentSystem || !currentSystem.planets || currentSystem.planets.length === 0) {
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
      this.targetIndicator.stroke({ width: 1, color: 0x00ffff, alpha: pulse * 0.8 });
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
    // IMPORTANT: Keep eventMode as 'none' to not block clicks on space
    this.uiContainer.eventMode = 'none';

    // Instructions (non-interactive)
    const instructions = new Text({
      text: 'Клик на планету - установить курс | Клик в космос - свободный полёт | [J] - Квесты | [I] - Инвентарь',
      style: {
        fontFamily: 'Courier New',
        fontSize: 13,
        fill: 0x88ccff,
      },
    });
    instructions.alpha = 0.8;
    instructions.x = 20;
    instructions.y = 20;
    instructions.eventMode = 'none'; // Explicitly set to non-interactive
    this.uiContainer.addChild(instructions);

    // Quest Journal button
    const questBtn = new Text({
      text: '[КВЕСТЫ]',
      style: {
        fontFamily: 'Courier New',
        fontSize: 14,
        fill: 0xffaa00,
        fontWeight: 'bold' as const,
      },
    });
    questBtn.x = 20;
    questBtn.y = 50;
    questBtn.eventMode = 'static';
    questBtn.cursor = 'pointer';
    questBtn.on('pointerdown', (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info('Quest journal button clicked');
      this.toggleQuestJournal();
    });
    questBtn.on('pointerover', () => { questBtn.alpha = 0.7; });
    questBtn.on('pointerout', () => { questBtn.alpha = 1; });
    this.uiContainer.addChild(questBtn);

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
    backBtn.on('pointerdown', async (event) => {
      event.stopPropagation(); // Prevent stage from also handling this click
      logger.info('Back to map clicked');
      await this.returnToStarMap();
    });

    // Add hover effect
    backBtn.on('pointerover', () => { backBtn.alpha = 0.7; });
    backBtn.on('pointerout', () => { backBtn.alpha = 1; });

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
    if (!currentSystem || !currentSystem.planets || currentSystem.planets.length === 0) {
      logger.debug('No planets in current system');
      return;
    }

    // Get quest objective locations
    const questLocations = this.gameEngine.questManager.getActiveQuestLocations();

    // Create sprite for each planet with random initial angle
    for (const planet of currentSystem.planets) {
      const initialAngle = Math.random() * Math.PI * 2;
      const sprite = new PlanetSprite(planet, this.starCenterX, this.starCenterY, initialAngle);

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
      () => this.onTalkToGovernor(planet),
    );
    this.renderer.uiLayer.addChild(this.planetInfoPanel.container);

    // Find planet sprite to get screen coordinates and set navigation target
    const planetSprite = this.planetSprites.find((s) => s.planet.id === planet.id);
    if (planetSprite && this.shipPhysics) {
      this.shipPhysics.setTarget(planetSprite.screenX, planetSprite.screenY);
    }
  }

  /**
   * Handle "Talk to Governor" button click: transition to DialogueScene
   */
  private async onTalkToGovernor(planet: Planet): Promise<void> {
    logger.info(`Opening dialogue with governor of ${planet.name}`);

    // Update quest progress for visiting this location
    if (this.gameEngine?.questManager) {
      this.gameEngine.questManager.updateQuestProgress({
        type: 'VISIT_LOCATION',
        locationId: planet.id,
      });
      logger.debug(`Updated quest progress for visiting ${planet.name}`);
    }

    // Get the governor NPC (first inhabitant)
    if (planet.inhabitants.length === 0) {
      logger.warn(`No inhabitants on planet ${planet.name}`);
      return;
    }

    const governor = planet.inhabitants[0];

    // Transition to DialogueScene with the governor
    if (this.gameEngine) {
      await this.gameEngine.transitionTo(SceneType.DIALOGUE, {
        gameEngine: this.gameEngine,
        npc: governor,
      });
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

  /**
   * Update planet positions for orbital rotation and mini-map
   */
  private updatePlanets(deltaTime: number): void {
    for (const sprite of this.planetSprites) {
      sprite.update(deltaTime);
    }

    // Update mini-map with current positions
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

  /**
   * Handle keyboard input (J key for quest journal)
   */
  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'j' || event.key === 'J') {
      this.toggleQuestJournal();
    } else if (event.key === 'i' || event.key === 'I') {
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
      logger.info('Quest journal closed');
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
        logger.info('Quest journal opened');
      }
    }
  }

  /**
   * Open inventory scene
   */
  private async openInventory(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info('Opening inventory');
    await this.gameEngine.transitionTo('INVENTORY' as any, {
      gameEngine: this.gameEngine,
    });
  }

  /**
   * Navigate ship to quest objective location (planet)
   */
  private navigateToQuestObjective(locationId: string): void {
    logger.info(`Navigating to quest objective: ${locationId}`);

    // Find planet sprite by locationId
    const planetSprite = this.planetSprites.find((s) => s.planet.id === locationId);
    if (planetSprite && this.shipPhysics) {
      // Set ship target to planet
      this.shipPhysics.setTarget(planetSprite.screenX, planetSprite.screenY);
      logger.info(`Set navigation target to planet ${planetSprite.planet.name}`);

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
}
