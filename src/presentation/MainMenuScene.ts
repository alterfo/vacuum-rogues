import { GameScene } from "./GameScene";
import { Graphics, Text, Container, Sprite } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { buildInfo } from "@/systems/feedback/buildInfo";
import { openFeedback } from "@/systems/feedback/openFeedback";
import { resetSeen } from "@/systems/onboarding/onboardingState";
import { pickVariant } from "./textures";
import { t } from "@/i18n/i18n";
import { SettingsPanel, SETTINGS_PANEL_WIDTH } from "./ui/SettingsPanel";
import { GAME_BALANCE } from "@/config/balance";

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

interface MenuPlanet {
  node: Container;
  spin: number;
}

const SHIP_SPRITE_ROTATION = Math.PI / 2;

export class MainMenuScene extends GameScene {
  private background: Graphics | null = null;
  private buttonsContainer: Container | null = null;
  private title: Text | null = null;
  private intro: Text | null = null;
  private gameEngine: GameEngine | null = null;
  private messageTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private currentMsgText: Text | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private starParticles: StarParticle[] = [];
  private starGraphics: Graphics | null = null;
  private demoShips: DemoShip[] = [];
  private menuPlanets: MenuPlanet[] = [];
  private saveAvailable = false;
  private settingsPanel: SettingsPanel | null = null;
  private settingsBackdrop: Graphics | null = null;
  private renderGen = 0;

  initialize(context?: object): void {
    this.renderer.app.stage.eventMode = "static";

    this.gameEngine =
      (context as { gameEngine?: GameEngine })?.gameEngine ?? null;
    this.renderMainMenu();
    void this.checkSaveAvailability();

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

    if (this.starGraphics) {
      this.starGraphics.clear();
      for (const s of this.starParticles) {
        const tw =
          Math.sin(time * s.twinkleSpeed + s.twinkleOffset) * 0.3 + 0.7;
        this.starGraphics.fill({ color: s.color, alpha: s.alpha * tw });
        this.starGraphics.circle(s.x, s.y, s.size);

        s.x += s.speed * s.layer * deltaTime * 0.01;
        if (s.x > w + 10) {
          s.x = -10;
          s.y = Math.random() * h;
        }
      }
    }

    if (w > 0 && h > 0) {
      for (const ship of this.demoShips) {
        ship.angle += deltaTime * ship.speed;
        ship.container.x = w * 0.5 + Math.cos(ship.angle) * w * ship.radius;
        ship.container.y =
          h * 0.5 + Math.sin(ship.angle * 0.7) * h * ship.offsetY;
        ship.container.rotation = ship.angle + Math.PI / 2;
      }
    }

    for (const p of this.menuPlanets) {
      p.node.rotation += p.spin * deltaTime;
    }
  }

  private async checkSaveAvailability(): Promise<void> {
    if (!this.gameEngine?.saveManager) return;
    const hasSave = await this.gameEngine.saveManager.hasSave();
    if (hasSave !== this.saveAvailable) {
      this.saveAvailable = hasSave;
      this.renderMainMenu();
    }
  }

  destroy(): void {
    this.renderGen++; // invalidate any in-flight async texture mounts
    this.closeSettings(); // settings overlay lives on renderer.stage, not the cleared layers
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.messageTimeoutId) {
      clearTimeout(this.messageTimeoutId);
      this.messageTimeoutId = null;
    }
    this.currentMsgText = null;
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.background = null;
    this.buttonsContainer = null;
    this.title = null;
    this.intro = null;
    this.gameEngine = null;
    this.starGraphics = null;
    this.demoShips = [];
    this.menuPlanets = [];
    this.starParticles = [];
    logger.info("MainMenuScene destroyed");
  }

  private renderMainMenu(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    if (width === 0 || height === 0) {
      logger.warn("MainMenuScene: canvas size is zero, deferring render");
      return;
    }

    this.closeSettings();

    this.renderGen++; // invalidate async mounts from the previous render
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    this.background = new Graphics();
    this.background.rect(0, 0, width, height);
    this.background.fill({
      color: 0x000510,
      alpha: 1,
    });
    this.renderer.gameLayer.addChild(this.background);

    const gradientOverlay = new Graphics();
    gradientOverlay.circle(width * 0.3, height * 0.2, width * 0.4);
    gradientOverlay.fill({ color: 0x0a0a30, alpha: 0.15 });
    gradientOverlay.circle(width * 0.7, height * 0.8, width * 0.3);
    gradientOverlay.fill({ color: 0x1a0520, alpha: 0.1 });
    this.renderer.gameLayer.addChild(gradientOverlay);

    this.menuPlanets = [];
    const planetSpecs = [
      {
        prefix: "gas",
        seed: "menu_planet_1",
        radius: 90,
        fx: 0.15,
        fy: 0.75,
        alpha: 0.6,
        spin: 0.00002,
        fallback: 0x4a3520,
      },
      {
        prefix: "habitat",
        seed: "menu_planet_2",
        radius: 58,
        fx: 0.85,
        fy: 0.3,
        alpha: 0.5,
        spin: -0.000015,
        fallback: 0x204a45,
      },
    ];
    for (const spec of planetSpecs) {
      const node = new Container();
      node.x = width * spec.fx;
      node.y = height * spec.fy;
      node.eventMode = "none"; // decorative
      const planetTex = pickVariant("planets", spec.prefix, spec.seed);
      if (planetTex) {
        const sp = new Sprite(planetTex);
        sp.anchor.set(0.5);
        const s = (spec.radius * 2) / Math.max(planetTex.width, 1);
        sp.scale.set(s);
        sp.alpha = spec.alpha;
        node.addChild(sp);
      } else {
        const g = new Graphics();
        g.circle(0, 0, spec.radius);
        g.fill({ color: spec.fallback, alpha: 0.2 });
        node.addChild(g);
      }
      this.menuPlanets.push({ node, spin: spec.spin });
      this.renderer.gameLayer.addChild(node);
    }

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

    this.demoShips = [];

    const ship1 = this.createShip(
      16,
      0x4488cc,
      0x88ccff,
      0.6,
      "ranger",
      "menu_ship_1",
    );
    this.demoShips.push({
      container: ship1,
      angle: 0,
      speed: 0.00005,
      radius: 0.35,
      offsetY: 0.25,
    });

    const ship2 = this.createShip(
      10,
      0x44cc88,
      0x88ffcc,
      0.4,
      "trader",
      "menu_ship_2",
    );
    this.demoShips.push({
      container: ship2,
      angle: Math.PI,
      speed: 0.00007,
      radius: 0.28,
      offsetY: 0.18,
    });

    const ship3 = this.createShip(
      12,
      0xcc8844,
      0xffcc88,
      0.35,
      "patrol",
      "menu_ship_3",
    );
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

    this.title = new Text({
      text: t("menu.title"),
      style: {
        fontFamily: "Courier New",
        fontSize: 38,
        fill: 0x00ffff,
        letterSpacing: 6,
        align: "center",
        lineHeight: 46,
        dropShadow: {
          color: 0x00ffff,
          alpha: 0.4,
          blur: 10,
          distance: 0,
          angle: 0,
        },
      },
    });
    this.title.anchor.set(0.5);
    this.title.x = width / 2;
    this.title.y = height / 3;
    this.renderer.uiLayer.addChild(this.title);

    this.intro = new Text({
      text: t("menu.intro"),
      style: {
        fontFamily: "Courier New",
        fontSize: 15,
        fill: 0xaad4e6,
        align: "center",
        lineHeight: 22,
        wordWrap: true,
        wordWrapWidth: Math.min(600, width - 80),
      },
    });
    this.intro.anchor.set(0.5, 0);
    this.intro.x = width / 2;
    this.intro.y = height / 3 + 48;
    this.renderer.uiLayer.addChild(this.intro);

    this.buttonsContainer = new Container();
    this.buttonsContainer.x = width / 2;
    this.buttonsContainer.y = Math.max(
      height / 2,
      this.intro.y + this.intro.height + 28,
    );

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

    const newGameBtn = createButton(
      t("menu.newGame"),
      0,
      () => this.handleNewGame(),
      20,
      0x66ffff,
    );
    this.buttonsContainer.addChild(newGameBtn);

    const continueBtn = createButton(
      t("common.continue"),
      50,
      () => this.handleContinue(),
      20,
      this.saveAvailable ? 0xffaa00 : 0x556677,
    );
    if (!this.saveAvailable) {
      continueBtn.eventMode = "none";
      continueBtn.alpha = 0.5;
    }
    this.buttonsContainer.addChild(continueBtn);

    const savesBtn = createButton(
      t("menu.saves"),
      95,
      () => this.handleSaveLoad(),
      18,
      0x88ddff,
    );
    this.buttonsContainer.addChild(savesBtn);

    const settingsBtn = createButton(
      t("menu.settings"),
      135,
      () => this.toggleSettings(),
      18,
      0x88ddff,
    );
    this.buttonsContainer.addChild(settingsBtn);

    const feedbackBtn = createButton(
      t("menu.feedback"),
      175,
      () => this.handleFeedback(),
      16,
      0x66ccff,
    );
    this.buttonsContainer.addChild(feedbackBtn);

    const replayHelpBtn = createButton(
      t("menu.replayTutorial"),
      215,
      () => this.handleReplayOnboarding(),
      16,
      0x66ccff,
    );
    this.buttonsContainer.addChild(replayHelpBtn);

    const arcadeBtn = createButton(
      t("menu.arcade"),
      255,
      () => this.handleArcade(),
      16,
      0xff99ff,
    );
    this.buttonsContainer.addChild(arcadeBtn);

    this.renderer.uiLayer.addChild(this.buttonsContainer);
  }

  private async handleArcade(): Promise<void> {
    if (!this.gameEngine) {
      this.showMessage(t("menu.engineUnavailable"));
      return;
    }
    try {
      await this.gameEngine.transitionTo(SceneType.BLACK_HOLE_ARCADE, {
        gameEngine: this.gameEngine,
      });
    } catch (error) {
      logger.error("Failed to open the arcade:", error);
      this.showMessage(t("menu.engineUnavailable"));
    }
  }

  private toggleSettings(): void {
    if (this.settingsPanel) {
      this.closeSettings();
      return;
    }
    this.openSettings();
  }

  private openSettings(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.5 });
    backdrop.eventMode = "static";
    backdrop.cursor = "default";
    backdrop.on("pointerdown", () => this.closeSettings());

    const panel = new SettingsPanel({
      speedTarget: this.gameEngine ?? {
        gameSpeedMultiplier: GAME_BALANCE.gameSpeedDefault,
      },
      speedSteps: GAME_BALANCE.gameSpeedMultipliers,
      applySpeed: () => {},
      applyFont: () => this.renderMainMenu(),
      applyLanguage: () => this.renderMainMenu(),
      onNeuralToggle: (on) =>
        this.showMessage(
          on ? t("settings.neuralOn") : t("settings.neuralOff"),
          on ? 0x00ccff : 0x99a8ba,
        ),
      onRequestClose: () => this.closeSettings(),
    });

    const left = Math.round((width - SETTINGS_PANEL_WIDTH) / 2);
    const c = panel.container;
    c.x = left;
    c.y = Math.round((height - panel.heightPx) / 2);

    this.renderer.stage.addChild(backdrop);
    this.renderer.stage.addChild(c);
    this.settingsBackdrop = backdrop;
    this.settingsPanel = panel;
  }

  private closeSettings(): void {
    const panel = this.settingsPanel;
    const backdrop = this.settingsBackdrop;
    this.settingsPanel = null;
    this.settingsBackdrop = null;
    if (panel)
      queueMicrotask(() => {
        if (!panel.container.destroyed) panel.destroy();
      });
    if (backdrop)
      queueMicrotask(() => {
        if (!backdrop.destroyed) backdrop.destroy();
      });
  }

  private handleSaveLoad(): void {
    if (!this.gameEngine) {
      logger.error("GameEngine not available for Save/Load!");
      this.showMessage(t("menu.engineUnavailable"));
      return;
    }
    void this.gameEngine.transitionTo(SceneType.SAVE_LOAD, {
      gameEngine: this.gameEngine,
      returnTo: SceneType.MAIN_MENU,
    });
  }

  private handleFeedback(): void {
    const { version, sha } = buildInfo();
    const galaxy = this.gameEngine?.galaxy ?? null;
    openFeedback({
      version,
      sha,
      scene: SceneType.MAIN_MENU,
      day: galaxy?.gameDays ?? 0,
      seed: galaxy?.id ?? "—",
    });
  }

  private handleReplayOnboarding(): void {
    logger.info("Replaying onboarding — clearing seen help-hints");
    resetSeen();
    this.showMessage(t("menu.tutorialReset"), 0x66ffcc);
  }

  private async handleNewGame(): Promise<void> {
    logger.info("New game selected");
    if (this.gameEngine) {
      await this.gameEngine.restartNewGame();
    } else {
      logger.error("GameEngine not available!");
    }
  }

  private async handleContinue(): Promise<void> {
    logger.info("Continue selected");
    if (!this.gameEngine) {
      logger.error("GameEngine not available for Continue!");
      this.showMessage(t("menu.engineUnavailable"));
      return;
    }

    if (this.buttonsContainer) {
      this.buttonsContainer.eventMode = "none";
      this.buttonsContainer.alpha = 0.5;
    }
    this.gameEngine.showLoadingOverlay(t("menu.loading"));

    try {
      const loaded = await this.gameEngine.continueGame();
      if (!loaded) {
        logger.warn("No save found for continue");
        this.gameEngine?.hideLoadingOverlay();
        if (this.buttonsContainer) {
          this.buttonsContainer.eventMode = "auto";
          this.buttonsContainer.alpha = 1;
        }
        this.showMessage(t("menu.noSaves"));
      }
    } catch (error) {
      logger.error("Failed to load save:", error);
      this.gameEngine?.hideLoadingOverlay();
      if (this.buttonsContainer) {
        this.buttonsContainer.eventMode = "auto";
        this.buttonsContainer.alpha = 1;
      }
      this.showMessage(t("menu.loadError"));
    }
  }

  private showMessage(message: string, color = 0xff4444): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    if (this.messageTimeoutId) {
      clearTimeout(this.messageTimeoutId);
      this.messageTimeoutId = null;
    }
    if (this.currentMsgText) {
      if (this.currentMsgText.parent) {
        this.renderer.uiLayer.removeChild(this.currentMsgText);
      }
      this.currentMsgText.destroy();
      this.currentMsgText = null;
    }

    const msgText = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: color,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    const buttonsY = this.buttonsContainer
      ? this.buttonsContainer.y
      : height / 2;
    msgText.y = buttonsY + 255;
    this.renderer.uiLayer.addChild(msgText);
    this.currentMsgText = msgText;

    this.messageTimeoutId = setTimeout(() => {
      if (msgText.parent) {
        this.renderer.uiLayer.removeChild(msgText);
      }
      msgText.destroy();
      this.messageTimeoutId = null;
      this.currentMsgText = null;
    }, 5000);
  }

  private createShip(
    size: number,
    primaryColor: number,
    accentColor: number,
    alpha: number,
    artPrefix?: string,
    artSeed?: string,
  ): Container {
    const container = new Container();

    if (artPrefix && artSeed) {
      const shipTex = pickVariant("ships", artPrefix, artSeed);
      if (shipTex) {
        const sp = new Sprite(shipTex);
        sp.anchor.set(0.5);
        const scale = (size * 2.4) / Math.max(shipTex.width, shipTex.height, 1);
        sp.scale.set(scale);
        sp.rotation = SHIP_SPRITE_ROTATION;
        sp.alpha = Math.min(1, alpha + 0.35);
        container.addChild(sp);
        return container;
      }
    }

    const shipG = new Graphics();

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
