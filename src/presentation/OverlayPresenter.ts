import { Graphics, Text } from "pixi.js";
import type { IOverlayPresenter } from "@/core/ports/IOverlayPresenter";
import type { Renderer } from "@/presentation/Renderer";

export class OverlayPresenter implements IOverlayPresenter {
  private modalObjects: (Graphics | Text)[] = [];
  private loadingOverlayObjects: (Graphics | Text)[] = [];

  constructor(private readonly getRenderer: () => Renderer | null) {}

  private get renderer(): Renderer | null {
    return this.getRenderer();
  }

  showError(message: string, onDismiss?: () => void): void {
    const renderer = this.renderer;
    if (!renderer) return;

    this.clearModal();

    const width = renderer.app.screen.width;
    const height = renderer.app.screen.height;

    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.85 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    renderer.uiLayer.addChild(overlay);
    this.modalObjects.push(overlay);

    const msgText = new Text({
      text: message,
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xff4444,
        align: "center",
        wordWrap: true,
        wordWrapWidth: width * 0.8,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    msgText.y = height / 2 - 40;
    renderer.uiLayer.addChild(msgText);
    this.modalObjects.push(msgText);

    if (onDismiss) {
      const btnText = new Text({
        text: "Новая игра",
        style: {
          fontFamily: "Courier New",
          fontSize: 20,
          fill: 0x00ff00,
          fontWeight: "bold",
        },
      });
      btnText.anchor.set(0.5);
      btnText.x = width / 2;
      btnText.y = height / 2 + 40;
      btnText.eventMode = "static";
      btnText.cursor = "pointer";

      btnText.on("pointerdown", () => {
        this.clearModal();
        onDismiss();
      });
      btnText.on("pointerover", () => {
        btnText.alpha = 0.7;
      });
      btnText.on("pointerout", () => {
        btnText.alpha = 1;
      });

      renderer.uiLayer.addChild(btnText);
      this.modalObjects.push(btnText);
    }
  }

  dismissAll(): void {
    this.clearModal();
    this.hideLoading();
  }

  clearModal(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    for (const obj of this.modalObjects) {
      if (obj.parent) {
        renderer.uiLayer.removeChild(obj);
      }
      obj.destroy();
    }
    this.modalObjects = [];
  }

  showLoading(text: string): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.hideLoading();

    const width = renderer.app.screen.width;
    const height = renderer.app.screen.height;

    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.75 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    renderer.uiLayer.addChild(overlay);
    this.loadingOverlayObjects.push(overlay);

    const labelText = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0x00ffff,
      },
    });
    labelText.anchor.set(0.5);
    labelText.x = width / 2;
    labelText.y = height / 2;
    labelText.eventMode = "none";
    renderer.uiLayer.addChild(labelText);
    this.loadingOverlayObjects.push(labelText);
  }

  hideLoading(): void {
    for (const obj of this.loadingOverlayObjects) {
      if (obj.parent) {
        obj.parent.removeChild(obj);
      }
      obj.destroy();
    }
    this.loadingOverlayObjects = [];
  }

  showGameOutcome(
    win: boolean,
    handlers: { onRestart: () => void; onNewGamePlus?: () => void },
  ): void {
    const renderer = this.renderer;
    if (!renderer) return;
    this.clearModal();

    const width = renderer.app.screen.width;
    const height = renderer.app.screen.height;

    const overlay = new Graphics();
    overlay.fill({ color: 0x000000, alpha: 0.9 });
    overlay.rect(0, 0, width, height);
    overlay.eventMode = "static";
    renderer.uiLayer.addChild(overlay);
    this.modalObjects.push(overlay);

    const titleColor = win ? 0xffdd44 : 0xff4444;
    const titleStr = win ? "ПОБЕДА!" : "КОНЕЦ ИГРЫ";

    const titleText = new Text({
      text: titleStr,
      style: {
        fontFamily: "Courier New",
        fontSize: 36,
        fill: titleColor,
        fontWeight: "bold",
      },
    });
    titleText.anchor.set(0.5);
    titleText.x = width / 2;
    titleText.y = height / 2 - 80;
    titleText.eventMode = "none";
    renderer.uiLayer.addChild(titleText);
    this.modalObjects.push(titleText);

    const msg = win
      ? "Ветеран-Дипломат.\nГалактика под вашей защитой!"
      : "Галактика пала.\nOVERMIND установил контроль над большинством систем.";

    const msgText = new Text({
      text: msg,
      style: {
        fontFamily: "Courier New",
        fontSize: 18,
        fill: 0xcccccc,
        align: "center",
        wordWrap: true,
        wordWrapWidth: width * 0.65,
      },
    });
    msgText.anchor.set(0.5);
    msgText.x = width / 2;
    msgText.y = height / 2;
    msgText.eventMode = "none";
    renderer.uiLayer.addChild(msgText);
    this.modalObjects.push(msgText);

    const makeButton = (
      label: string,
      y: number,
      color: number,
      onClick: () => void,
    ): void => {
      const btn = new Text({
        text: label,
        style: {
          fontFamily: "Courier New",
          fontSize: 22,
          fill: color,
          fontWeight: "bold",
        },
      });
      btn.anchor.set(0.5);
      btn.x = width / 2;
      btn.y = y;
      btn.eventMode = "static";
      btn.cursor = "pointer";
      btn.on("pointerdown", onClick);
      btn.on("pointerover", () => {
        btn.alpha = 0.7;
      });
      btn.on("pointerout", () => {
        btn.alpha = 1;
      });
      renderer.uiLayer.addChild(btn);
      this.modalObjects.push(btn);
    };

    const restart = (): void => {
      this.clearModal();
      handlers.onRestart();
    };

    if (win) {
      if (handlers.onNewGamePlus) {
        const onNewGamePlus = handlers.onNewGamePlus;
        makeButton("Новая игра+", height / 2 + 70, 0x66ddff, () => {
          this.clearModal();
          onNewGamePlus();
        });
      }
      makeButton("Начать заново", height / 2 + 120, 0x00ff88, restart);
    } else {
      makeButton("Начать заново", height / 2 + 90, 0x00ff88, restart);
    }
  }
}
