import { Container, Graphics } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { scaledText } from "./ui/scaledText";
import { logger } from "@/utils/logger";

interface GameOverContext {
  gameEngine?: GameEngine;
}

interface GameOverAction {
  readonly label: string;
  readonly run: () => void;
}

/**
 * Terminal screen shown when the player ship is destroyed in flight combat
 * (plan 20260619-player-death-gameover-and-takeoff-autosave). Mirrors the
 * WinScene terminal-screen shape but offers two non-destructive recoveries:
 *
 *  - «Загрузить сохранение» rolls back to the last takeoff autosave (the
 *    `"auto"` slot — death never overwrites it, so this returns the player to
 *    their most recent takeoff).
 *  - «Начать заново» starts a fresh game via the existing race-selection path.
 *
 * The two actions are the single source of truth for both rendering and the
 * e2e/test seam ({@link e2eActions}), so a test can assert the labels without
 * pixel-clicking.
 */
export class GameOverScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private container: Container | null = null;

  private readonly actions: readonly GameOverAction[] = [
    { label: "Загрузить сохранение", run: () => this.loadAutosave() },
    { label: "Начать заново", run: () => this.startOver() },
  ];

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as GameOverContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;

    this.container = new Container();
    this.renderer.uiLayer.addChild(this.container);
    this.render();
    logger.info("GameOverScene initialized");
  }

  update(_dt: number): void {}

  destroy(): void {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.gameEngine = null;
  }

  /** e2e/test seam: the recovery action labels in display order. */
  e2eActions(): string[] {
    return this.actions.map((a) => a.label);
  }

  /** e2e/test seam: invoke an action by its label (bypasses pixel hit-testing). */
  e2eRunAction(label: string): void {
    this.actions.find((a) => a.label === label)?.run();
  }

  private render(): void {
    if (!this.container) return;
    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x100305, alpha: 1 });
    bg.eventMode = "static";
    this.container.addChild(bg);

    this.addText("КОРАБЛЬ УНИЧТОЖЕН", w / 2, h * 0.2, 44, 0xff5544, "bold");
    this.addText("Ваш корабль погиб в бою.", w / 2, h * 0.31, 20, 0xddaaaa);

    const btnW = 320;
    const btnH = 46;
    let by = h * 0.48;
    for (const action of this.actions) {
      const btn = this.makeButton(
        action.label,
        w / 2 - btnW / 2,
        by,
        btnW,
        btnH,
      );
      btn.on("pointerdown", (e) => {
        e.stopPropagation();
        action.run();
      });
      this.container.addChild(btn);
      by += btnH + 22;
    }
  }

  /** «Загрузить сохранение» → restore the last takeoff autosave (`"auto"`). */
  private loadAutosave(): void {
    const engine = this.gameEngine;
    if (!engine) {
      logger.error("GameOverScene: no engine to load autosave");
      return;
    }
    engine.showLoadingOverlay("Загрузка...");
    engine
      .loadGame("auto")
      .then((loaded) => {
        if (!loaded) {
          engine.hideLoadingOverlay();
          logger.warn("GameOverScene: no takeoff autosave to load");
        }
        // On success loadGame transitions away → this scene is destroyed.
      })
      .catch((err) => {
        engine.hideLoadingOverlay();
        logger.error("GameOverScene: load autosave failed", err);
      });
  }

  /**
   * «Начать заново» → the existing new-game path. Routes through
   * {@link GameEngine.restartNewGame} so game state is reset (player nulled,
   * galaxy regenerated, guards cleared) BEFORE race selection — otherwise the
   * dead player carries over and the "fresh" game reuses the destroyed ship.
   */
  private startOver(): void {
    const engine = this.gameEngine;
    if (!engine) {
      logger.error("GameOverScene: no engine to start over");
      return;
    }
    engine
      .restartNewGame()
      .catch((err) => logger.error("GameOverScene: start-over failed", err));
  }

  private addText(
    text: string,
    x: number,
    y: number,
    size: number,
    color: number,
    weight: "bold" | "normal" = "normal",
  ): void {
    if (!this.container) return;
    const t = scaledText(text, size, color, {
      align: "center",
      fontWeight: weight,
    });
    t.eventMode = "none";
    t.anchor.set(0.5, 0);
    t.x = x;
    t.y = y;
    this.container.addChild(t);
  }

  private makeButton(
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Container {
    const btn = new Container();
    btn.x = x;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";

    const bg = new Graphics();
    const paint = (fill: number, stroke: number): void => {
      bg.clear();
      bg.rect(0, 0, w, h);
      bg.fill({ color: fill, alpha: 0.92 });
      bg.stroke({ color: stroke, width: 2 });
    };
    paint(0x441118, 0xff6655);
    btn.addChild(bg);

    const lbl = scaledText(label, 18, 0xffd0c4, { fontWeight: "bold" });
    lbl.anchor.set(0.5);
    lbl.x = w / 2;
    lbl.y = h / 2;
    lbl.eventMode = "none";
    btn.addChild(lbl);

    btn.on("pointerover", () => paint(0x662029, 0xff8877));
    btn.on("pointerout", () => paint(0x441118, 0xff6655));

    return btn;
  }
}
