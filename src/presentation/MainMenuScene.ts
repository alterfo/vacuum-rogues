import { GameScene } from "./GameScene";
import { Graphics, Text, Container } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";

interface StarParticle {
  x: number;
  y: number;
  size: number;
  speed: number;
  alpha: number;
  twinkleSpeed: number;
  twinkleOffset: number;
  color: number;
  layer: number;
}

interface DemoShip {
  container: Container;
  angle: number;
  speed: number;
  radius: number;
  offsetY: number;
}

export class MainMenuScene extends GameScene {
  private background: Graphics | null = null;
  private buttonsContainer: Container | null = null;
  private title: Text | null = null;
  private gameEngine: GameEngine | null = null;
  private messageTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private starParticles: StarParticle[] = [];
  private starGraphics: Graphics | null = null;
  private demoShips: DemoShip[] = [];
  private planets: Graphics[] = [];

  initialize(context?: object): void {
    // Ensure stage is interactive so pointer events reach children
    this.renderer.app.stage.eventMode = "static";

    this.gameEngine =
      (context as { gameEngine?: GameEngine })?.gameEngine ?? null;
    this.renderMainMenu();

    // Re-render menu when canvas actually gets its size (fixes first-load centering)
    if (typeof ResizeObserver !== "undefined" && this.renderer.app.canvas) {
      this.resizeObserver = new ResizeObserver(() => {
        this.renderMainMenu();
      });
      this.resizeObserver.observe(this.renderer.app.canvas);
    }

    logger.info("MainMenuScene initialized");
  }

  update(deltaTime: number): void {
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;
    const time = performance.now();

    // Animate stars with parallax and twinkling
    if (this.starGraphics) {
      this.starGraphics.clear();
      for (const s of this.starParticles) {
        // Twinkling effect
        const tw =
          Math.sin(time * s.twinkleSpeed + s.twinkleOffset) * 0.3 + 0.7;
        this.starGraphics.fill({ color: s.color, alpha: s.alpha * tw });
        this.starGraphics.circle(s.x, s.y, s.size);

        // Parallax scrolling (slower for distant stars)
        s.x += s.speed * s.layer * deltaTime * 0.01;
        if (s.x > w + 10) {
          s.x = -10;
          s.y = Math.random() * h;
        }
      }
    }

    // Animate multiple ships
    if (w > 0 && h > 0) {
      for (const ship of this.demoShips) {
        ship.angle += deltaTime * ship.speed;
        ship.container.x = w * 0.5 + Math.cos(ship.angle) * w * ship.radius;
        ship.container.y =
          h * 0.5 + Math.sin(ship.angle * 0.7) * h * ship.offsetY;
        ship.container.rotation = ship.angle + Math.PI / 2;
      }
    }
  }

  destroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.messageTimeoutId) {
      clearTimeout(this.messageTimeoutId);
      this.messageTimeoutId = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.background = null;
    this.buttonsContainer = null;
    this.title = null;
    this.gameEngine = null;
    this.starGraphics = null;
    this.demoShips = [];
    this.planets = [];
    this.starParticles = [];
    logger.info("MainMenuScene destroyed");
  }

  private renderMainMenu(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Skip render if canvas hasn't received its size yet
    if (width === 0 || height === 0) {
      logger.warn("MainMenuScene: canvas size is zero, deferring render");
      return;
    }

    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Draw deep space gradient background
    this.background = new Graphics();
    this.background.rect(0, 0, width, height);
    this.background.fill({
      color: 0x000510,
      alpha: 1,
    });
    // Add subtle gradient effect with overlays
    const gradientOverlay = new Graphics();
    gradientOverlay.circle(width * 0.3, height * 0.2, width * 0.4);
    gradientOverlay.fill({ color: 0x0a0a30, alpha: 0.15 });
    gradientOverlay.circle(width * 0.7, height * 0.8, width * 0.3);
    gradientOverlay.fill({ color: 0x1a0520, alpha: 0.1 });
    this.background.addChild(gradientOverlay);
    this.renderer.gameLayer.addChild(this.background);

    // Add distant planets
    this.planets = [];
    const planet1 = new Graphics();
    planet1.circle(0, 0, 80);
    planet1.fill({ color: 0x4a3520, alpha: 0.2 });
    planet1.x = width * 0.15;
    planet1.y = height * 0.75;
    this.planets.push(planet1);
    this.renderer.gameLayer.addChild(planet1);

    const planet2 = new Graphics();
    planet2.circle(0, 0, 60);
    planet2.fill({ color: 0x204a45, alpha: 0.15 });
    planet2.x = width * 0.85;
    planet2.y = height * 0.3;
    this.planets.push(planet2);
    this.renderer.gameLayer.addChild(planet2);

    // Enhanced animated starfield with multiple layers and colors
    this.starParticles = [];
    this.starGraphics = new Graphics();

    const starColors = [0xffffff, 0xaaccff, 0xffddaa, 0xffaacc];

    for (let i = 0; i < 300; i++) {
      const layer = Math.random() < 0.3 ? 1 : Math.random() < 0.6 ? 2 : 3;
      this.starParticles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2.5 + 0.3,
        speed: Math.random() * 0.015 + 0.003,
        alpha: (Math.random() * 0.6 + 0.3) / layer,
        twinkleSpeed: Math.random() * 0.002 + 0.0005,
        twinkleOffset: Math.random() * Math.PI * 2,
        color: starColors[Math.floor(Math.random() * starColors.length)],
        layer,
      });
    }
    this.renderer.gameLayer.addChild(this.starGraphics);

    // Create multiple demo ships with different trajectories
    this.demoShips = [];

    // Main ship (player-like)
    const ship1 = this.createShip(16, 0x4488cc, 0x88ccff, 0.6);
    this.demoShips.push({
      container: ship1,
      angle: 0,
      speed: 0.00005,
      radius: 0.35,
      offsetY: 0.25,
    });

    // Smaller escort ships
    const ship2 = this.createShip(10, 0x44cc88, 0x88ffcc, 0.4);
    this.demoShips.push({
      container: ship2,
      angle: Math.PI,
      speed: 0.00007,
      radius: 0.28,
      offsetY: 0.18,
    });

    const ship3 = this.createShip(12, 0xcc8844, 0xffcc88, 0.35);
    this.demoShips.push({
      container: ship3,
      angle: Math.PI * 0.5,
      speed: 0.00004,
      radius: 0.32,
      offsetY: 0.22,
    });

    for (const ship of this.demoShips) {
      this.renderer.gameLayer.addChild(ship.container);
    }

    // Title
    this.title = new Text({
      text: "КОСМИЧЕСКИЕ РЕЙНДЖЕРЫ\nНЕЙРОСЕТЕВОЕ ВТОРЖЕНИЕ",
      style: {
        fontFamily: "Courier New",
        fontSize: 32,
        fill: 0x00ffff,
        letterSpacing: 6,
        align: "center",
        lineHeight: 40,
      },
    });
    this.title.anchor.set(0.5);
    this.title.x = width / 2;
    this.title.y = height / 3;
    this.renderer.uiLayer.addChild(this.title);

    // Buttons container
    this.buttonsContainer = new Container();
    this.buttonsContainer.x = width / 2;
    this.buttonsContainer.y = height / 2;

    // Helper to create clickable text button
    const createButton = (
      text: string,
      y: number,
      callback: () => void,
      fontSize = 20,
      color = 0x00ff00,
    ) => {
      const buttonText = new Text({
        text,
        style: {
          fontFamily: "Courier New",
          fontSize,
          fill: color,
          fontWeight: "bold" as const,
        },
      });
      buttonText.anchor.set(0.5, 0.5);
      buttonText.y = y;
      buttonText.eventMode = "static";
      buttonText.cursor = "pointer";

      buttonText.on("pointerdown", () => {
        logger.info(`Button clicked: ${text}`);
        callback();
      });
      buttonText.on("pointerover", () => {
        buttonText.alpha = 0.7;
      });
      buttonText.on("pointerout", () => {
        buttonText.alpha = 1;
      });

      return buttonText;
    };

    const newGameBtn = createButton("Новая игра", 0, () =>
      this.handleNewGame(),
    );
    this.buttonsContainer.addChild(newGameBtn);

    const continueBtn = createButton(
      "Продолжить",
      50,
      () => this.handleContinue(),
      20,
      0xffaa00,
    );
    this.buttonsContainer.addChild(continueBtn);

    this.renderer.uiLayer.addChild(this.buttonsContainer);
  }

  private async handleNewGame(): Promise<void> {
    logger.info("New game selected");
    // Transition to RACE_SELECTION for character creation
    if (this.gameEngine) {
      await this.gameEngine.transitionTo(SceneType.RACE_SELECTION, {
        gameEngine: this.gameEngine,
      });
    } else {
      logger.error("GameEngine not available!");
    }
  }

  private async handleContinue(): Promise<void> {
    logger.info("Continue selected");
    if (!this.gameEngine) {
      logger.error("GameEngine not available for Continue!");
      this.showMessage("Ошибка: игровой движок недоступен");
      return;
    }

    try {
      const loaded = await this.gameEngine.loadGame("auto");
      if (!loaded) {
        logger.warn("No save found for continue");
        this.showMessage("Нет доступных сохранений");
      }
    } catch (error) {
      logger.error("Failed to load save:", error);
      this.showMessage("Ошибка загрузки. Начните новую игру.");
      // Don't re-throw - menu should remain functional
    }
  }

  private showMessage(message: string): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Clear previous messages
    if (this.buttonsContainer) {
      for (const child of this.buttonsContainer.children) {
        if (child instanceof Text && child.text.includes("[")) {
          continue;
        }
      }
    }

    const msgText = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xff4444,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    const buttonsY = this.buttonsContainer
      ? this.buttonsContainer.y
      : height / 2;
    msgText.y = buttonsY + 100;
    this.renderer.uiLayer.addChild(msgText);

    // Remove after 3 seconds
    this.messageTimeoutId = setTimeout(() => {
      if (msgText.parent) {
        this.renderer.uiLayer.removeChild(msgText);
      }
      msgText.destroy();
      this.messageTimeoutId = null;
    }, 3000);
  }

  private createShip(
    size: number,
    primaryColor: number,
    accentColor: number,
    alpha: number,
  ): Container {
    const container = new Container();
    const shipG = new Graphics();

    // Main ship body
    shipG
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
      .fill({ color: primaryColor, alpha });

    // Cockpit/accent
    shipG
      .poly([
        size * 0.3,
        0,
        -size * 0.2,
        -size * 0.25,
        -size * 0.2,
        size * 0.25,
      ])
      .fill({ color: accentColor, alpha });

    container.addChild(shipG);
    return container;
  }
}
