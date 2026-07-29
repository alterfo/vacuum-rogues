import { GameScene } from "./GameScene";
import { Graphics, Text, Container, Sprite, type Texture } from "pixi.js";
import type { GameEngine } from "@/systems/GameEngine";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { buildInfo } from "@/systems/feedback/buildInfo";
import { openFeedback } from "@/systems/feedback/openFeedback";
import { resetSeen } from "@/systems/onboarding/onboardingState";
import { pickVariant, pickVariantKey, tex, loadTextureAsync } from "./textures";
import { t } from "@/i18n/i18n";
import { reducedMotion } from "./ui/reducedMotion";
import { SettingsPanel, SETTINGS_PANEL_WIDTH } from "./ui/SettingsPanel";
import {
  AccessibilityPanel,
  ACCESSIBILITY_PANEL_WIDTH,
  ACCESSIBILITY_PANEL_HEIGHT,
} from "./ui/AccessibilityPanel";
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
  /** Radians per millisecond of slow axial-looking rotation. */
  spin: number;
}

/** Matches the ship-art orientation convention (see NpcShipSprite). */
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
  // The shared settings panel (speed / font / language / neural), opened from the
  // «Настройки» menu button. Mounted on `renderer.stage` (above the UI layer) with
  // a dimmed backdrop so it survives the menu's `clearUILayer` re-renders; closed
  // on its own control, an outside click, or scene teardown
  // (`docs/plans/20260626-playtest-bugs-pause-help-infocenter-i18n.md`, Task 8 —
  // relocated here from the in-flight ⚙ HUD button).
  private settingsPanel: SettingsPanel | null = null;
  private settingsBackdrop: Graphics | null = null;
  // The accessibility group (colourblind ПАЛИТРА / МЕНЬШЕ ДВИЖЕНИЯ / key remap)
  // mounted beside the settings panel in the same overlay, so accessibility now
  // lives in the general Settings rather than only the in-flight ♿ HUD button
  // (`docs/plans/20260626-playtest-bugs-2-pause-victory-onboarding-accessibility.md`,
  // Task 4). It reuses the existing browser-level accessors — no new save field.
  private accessibilityPanel: AccessibilityPanel | null = null;
  // Bumped on every re-render/destroy so in-flight async texture mounts
  // (lazy nebula) for a stale render generation become no-ops (see CLAUDE.md
  // lazy-category pattern).
  private renderGen = 0;

  initialize(context?: object): void {
    // Ensure stage is interactive so pointer events reach children
    this.renderer.app.stage.eventMode = "static";

    this.gameEngine =
      (context as { gameEngine?: GameEngine })?.gameEngine ?? null;
    this.renderMainMenu();
    void this.checkSaveAvailability();

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

    // Accessibility: when reduced motion is active the menu backdrop is rendered
    // but frozen — stars/ships/planets are still drawn + positioned, just not
    // advanced, twinkled or spun (the decorative idle motion the preference targets).
    const reduced = reducedMotion();

    // Animate stars with parallax and twinkling
    if (this.starGraphics) {
      this.starGraphics.clear();
      for (const s of this.starParticles) {
        // Twinkling effect (held steady under reduced motion)
        const tw = reduced
          ? 1
          : Math.sin(time * s.twinkleSpeed + s.twinkleOffset) * 0.3 + 0.7;
        this.starGraphics.fill({ color: s.color, alpha: s.alpha * tw });
        this.starGraphics.circle(s.x, s.y, s.size);

        // Parallax scrolling (slower for distant stars)
        if (!reduced) {
          s.x += s.speed * s.layer * deltaTime * 0.01;
          if (s.x > w + 10) {
            s.x = -10;
            s.y = Math.random() * h;
          }
        }
      }
    }

    // Animate multiple ships (positioned every frame, only advanced when not reduced)
    if (w > 0 && h > 0) {
      for (const ship of this.demoShips) {
        if (!reduced) ship.angle += deltaTime * ship.speed;
        ship.container.x = w * 0.5 + Math.cos(ship.angle) * w * ship.radius;
        ship.container.y =
          h * 0.5 + Math.sin(ship.angle * 0.7) * h * ship.offsetY;
        ship.container.rotation = ship.angle + Math.PI / 2;
      }
    }

    // Slow planet rotation keeps the backdrop alive (frozen under reduced motion)
    if (!reduced) {
      for (const p of this.menuPlanets) {
        p.node.rotation += p.spin * deltaTime;
      }
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

    // Skip render if canvas hasn't received its size yet
    if (width === 0 || height === 0) {
      logger.warn("MainMenuScene: canvas size is zero, deferring render");
      return;
    }

    // A re-render rebuilds the whole UI layer; close any open settings overlay
    // first so a stale panel/backdrop (e.g. after a language pick re-renders the
    // menu, or a window resize) can't linger over the fresh menu. The panel lives
    // on `renderer.stage`, not the UI layer, so it would otherwise survive.
    this.closeSettings();

    this.renderGen++; // invalidate async mounts from the previous render
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    // Draw deep space gradient background
    this.background = new Graphics();
    this.background.rect(0, 0, width, height);
    this.background.fill({
      color: 0x000510,
      alpha: 1,
    });
    this.renderer.gameLayer.addChild(this.background);

    // Real nebula art as a dimmed backdrop (lazy category — async pattern)
    this.mountNebulaBackdrop(width, height);

    // Add subtle gradient effect with overlays
    const gradientOverlay = new Graphics();
    gradientOverlay.circle(width * 0.3, height * 0.2, width * 0.4);
    gradientOverlay.fill({ color: 0x0a0a30, alpha: 0.15 });
    gradientOverlay.circle(width * 0.7, height * 0.8, width * 0.3);
    gradientOverlay.fill({ color: 0x1a0520, alpha: 0.1 });
    this.renderer.gameLayer.addChild(gradientOverlay);

    // Add distant planets — real planet art when loaded, dim disc fallback
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
        // Texture not preloaded (tests / very early boot) — keep the old disc
        const g = new Graphics();
        g.circle(0, 0, spec.radius);
        g.fill({ color: spec.fallback, alpha: 0.2 });
        node.addChild(g);
      }
      this.menuPlanets.push({ node, spin: spec.spin });
      this.renderer.gameLayer.addChild(node);
    }

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

    // Smaller escort ships
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

    // Title
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

    // One-paragraph premise, between the title and the buttons.
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

    // Buttons container
    this.buttonsContainer = new Container();
    this.buttonsContainer.x = width / 2;
    // Keep the buttons at mid-screen, but push them below the premise paragraph
    // if it would otherwise reach them (robust across short windows).
    this.buttonsContainer.y = Math.max(
      height / 2,
      this.intro.y + this.intro.height + 28,
    );

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

    // Primary action: bright cyan so it reads as the strongest button while
    // still belonging to the menu's cyan accent family (0x88ddff/0x66ccff on the
    // secondary buttons below) — the old default 0x00ff00 green clashed with it.
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

    // Save/Load screen — full slot management (load any slot, name/overwrite,
    // delete). From the menu there is no live game, so it opens read-only-ish
    // (load + delete of existing saves); `returnTo` brings the player back here.
    const savesBtn = createButton(
      t("menu.saves"),
      95,
      () => this.handleSaveLoad(),
      18,
      0x88ddff,
    );
    this.buttonsContainer.addChild(savesBtn);

    // Settings (speed / font / language / neural) — relocated from the in-flight
    // ⚙ HUD button (Task 8). Reachable here so the player can change speed/font/
    // language/neural before a run; the choices persist via `gameSettings` and
    // apply on «Продолжить».
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

    // Replay the first-time onboarding hints (clears the browser-level "seen"
    // set so every screen's auto-hint shows again on next visit).
    const replayHelpBtn = createButton(
      t("menu.replayTutorial"),
      215,
      () => this.handleReplayOnboarding(),
      16,
      0x66ccff,
    );
    this.buttonsContainer.addChild(replayHelpBtn);

    this.renderer.uiLayer.addChild(this.buttonsContainer);
  }

  /**
   * Toggle the shared settings overlay (speed / font / language / neural). The
   * panel is the SAME `SettingsPanel` the in-flight HUD used before Task 8 moved
   * it here — every control writes through `gameSettings` (no new save field), so
   * a speed/font/language/neural choice persists and applies on «Продолжить».
   */
  private toggleSettings(): void {
    if (this.settingsPanel) {
      this.closeSettings();
      return;
    }
    this.openSettings();
  }

  /**
   * Mount the settings panel centred over a dimmed, click-to-close backdrop on
   * `renderer.stage` (above the UI layer, so a menu re-render can't clobber it).
   * A font/language pick re-renders the menu in place (live re-localize) then
   * closes; speed/neural re-render only the panel. Speed writes onto the engine's
   * `gameSpeedMultiplier` so the choice survives into flight.
   */
  private openSettings(): void {
    const width = this.renderer.app.screen.width;
    const height = this.renderer.app.screen.height;

    // Dimmed full-screen backdrop — clicking outside the panel closes it.
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
      // No live HUD/physics in the menu — the choice is persisted on the engine
      // store and applied when the player enters flight.
      applySpeed: () => {},
      // A font/language change re-renders the menu so its labels pick up the new
      // size/language immediately (the menu's own live re-localize).
      applyFont: () => this.renderMainMenu(),
      applyLanguage: () => this.renderMainMenu(),
      onNeuralToggle: (on) =>
        this.showMessage(
          on ? t("settings.neuralOn") : t("settings.neuralOff"),
          on ? 0x00ccff : 0x99a8ba,
        ),
      onRequestClose: () => this.closeSettings(),
    });

    // The accessibility group (colourblind palette / reduced-motion / key remap)
    // shares the overlay so accessibility lives in the general Settings (Task 4).
    // The menu itself draws no faction colours, so there is nothing to live-restyle
    // here: each control persists through its own browser-level accessor and the
    // panel re-renders its own rows. The colourblind faction hues then render under
    // the new palette on the faction-selection screen and in flight (both read
    // `factionColor` live), and reduced motion is honoured per-frame by the menu's
    // own `update`. The overlay stays open so the player can keep cycling.
    const accPanel = new AccessibilityPanel({
      onRequestClose: () => this.closeSettings(),
    });

    // Lay the two panels side by side, centred as a group.
    const GAP = 16;
    const groupW = SETTINGS_PANEL_WIDTH + GAP + ACCESSIBILITY_PANEL_WIDTH;
    const left = Math.round((width - groupW) / 2);
    const c = panel.container;
    c.x = left;
    c.y = Math.round((height - panel.heightPx) / 2);
    const a = accPanel.container;
    a.x = left + SETTINGS_PANEL_WIDTH + GAP;
    a.y = Math.round((height - ACCESSIBILITY_PANEL_HEIGHT) / 2);

    this.renderer.stage.addChild(backdrop);
    this.renderer.stage.addChild(c);
    this.renderer.stage.addChild(a);
    this.settingsBackdrop = backdrop;
    this.settingsPanel = panel;
    this.accessibilityPanel = accPanel;
  }

  /**
   * Tear down the settings overlay (panel + backdrop) if open. Refs are nulled
   * synchronously; the actual destroys are deferred to a microtask (guarded
   * against double-destroy) because this can fire from a pointerdown mid-dispatch
   * over the panel's own hit area / the backdrop (mirrors `FlightHud.closeModals`).
   */
  private closeSettings(): void {
    const panel = this.settingsPanel;
    const accPanel = this.accessibilityPanel;
    const backdrop = this.settingsBackdrop;
    this.settingsPanel = null;
    this.accessibilityPanel = null;
    this.settingsBackdrop = null;
    if (panel)
      queueMicrotask(() => {
        if (!panel.container.destroyed) panel.destroy();
      });
    if (accPanel)
      queueMicrotask(() => {
        if (!accPanel.container.destroyed) accPanel.destroy();
      });
    if (backdrop)
      queueMicrotask(() => {
        if (!backdrop.destroyed) backdrop.destroy();
      });
  }

  /**
   * Open the save/load screen, returning to the main menu when it closes. From
   * the menu there is no live game (player/galaxy are null until a load), so the
   * screen offers load/delete of existing saves rather than new manual saves —
   * the in-flight system-menu entry is where the player creates named saves.
   */
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

  /**
   * Open the prefilled GitHub Issue Form in a new tab. From the menu the only
   * live context is the build + (if a run is loaded) its galaxy seed/day; the
   * scene is MAIN_MENU. The URL shape is owned by `buildFeedbackUrl`.
   */
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

  /**
   * Replay onboarding: clear the browser-level "seen" set so every screen's
   * first-time help hint auto-shows again on the next visit (and «?» still
   * works as before). Browser-level only — no game-state/schema change, so it
   * survives «Новая игра» exactly like the rest of the onboarding flags.
   */
  private handleReplayOnboarding(): void {
    logger.info("Replaying onboarding — clearing seen help-hints");
    resetSeen();
    this.showMessage(t("menu.tutorialReset"), 0x66ffcc);
  }

  private async handleNewGame(): Promise<void> {
    logger.info("New game selected");
    // Run the FULL reset before character creation: restartNewGame clears the
    // prior in-session player/galaxy/quests/ledger/flight position, then enters
    // RACE_SELECTION. A bare transitionTo(RACE_SELECTION) would leave the old
    // player set, so the `!player` new-game gate is skipped and the previous game
    // carries through (playtest 2026-06-23).
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
      // Continue resumes the latest *meaningful* save across all slots (auto +
      // the manual grid), not just the `"auto"` autosave — so a more recent
      // named save (or one taken after the autosave hit a win/lose screen) wins.
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
      // On success: transitionTo was called inside loadGame → scene destroyed with overlay
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

    // Clear previous message
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
    // Below the button stack (the lowest button sits at relative y≈215).
    msgText.y = buttonsY + 255;
    this.renderer.uiLayer.addChild(msgText);
    this.currentMsgText = msgText;

    // Remove after 5 seconds
    this.messageTimeoutId = setTimeout(() => {
      if (msgText.parent) {
        this.renderer.uiLayer.removeChild(msgText);
      }
      msgText.destroy();
      this.messageTimeoutId = null;
      this.currentMsgText = null;
    }, 5000);
  }

  /**
   * Lazily mount a real nebula panorama behind the starfield. nebula/ is a
   * LAZY_PREFIXES category, so the texture may not be cached at first render —
   * follow the pickVariantKey + loadTextureAsync pattern with a render-
   * generation guard (CLAUDE.md, Texture Loading).
   */
  private mountNebulaBackdrop(width: number, height: number): void {
    const gen = this.renderGen;
    const key = pickVariantKey("nebula", "blue_far", "main_menu");
    if (!key) return;

    const mount = (t: Texture): void => {
      // Scene re-rendered (resize) or destroyed since the load started
      if (gen !== this.renderGen) return;
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      const cover = Math.max(
        width / Math.max(t.width, 1),
        height / Math.max(t.height, 1),
      );
      sp.scale.set(cover);
      sp.x = width / 2;
      sp.y = height / 2;
      sp.alpha = 0.5; // dimmed — the menu must stay subdued and readable
      sp.eventMode = "none";
      // Right above the flat background fill, below stars/planets/ships
      const layer = this.renderer.gameLayer;
      layer.addChildAt(sp, Math.min(1, layer.children.length));
    };

    const cached = tex(key);
    if (cached) mount(cached);
    else
      void loadTextureAsync(key).then((t) => {
        if (t) mount(t);
      });
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

    // Prefer real ship art (eager category — synchronously available after boot)
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
