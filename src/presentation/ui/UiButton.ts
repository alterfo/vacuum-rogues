import {
  Container,
  Graphics,
  Rectangle,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import { scaledFont } from "@/utils/fontScale";
import { touchHitArea } from "@/presentation/ui/responsiveLayout";

export type ButtonAccent = "primary" | "danger" | "success" | "neutral";

export const BUTTON_ACCENT_COLORS: Record<ButtonAccent, number> = {
  primary: 0x00ffee,
  danger: 0xff4444,
  success: 0x44ff88,
  neutral: 0x667788,
};

export class UiButton {
  public readonly container: Container;
  private bg: Graphics;
  private strip: Graphics;
  private iconTxt: Text;
  private labelTxt: Text;
  private _accent: number;
  private btnW: number;
  private btnH: number;

  constructor(
    icon: string,
    label: string,
    accent: ButtonAccent | number,
    onClick: (event: FederatedPointerEvent) => void,
    btnW = 160,
    btnH = 32,
  ) {
    this.btnW = btnW;
    this.btnH = btnH;
    this._accent =
      typeof accent === "number" ? accent : BUTTON_ACCENT_COLORS[accent];

    this.container = new Container();
    this.bg = new Graphics();
    this.bg.eventMode = "none";

    this.strip = new Graphics();
    this.strip.eventMode = "none";

    this.iconTxt = new Text({
      text: icon,
      style: {
        fontFamily: "Courier New, monospace",
        fontSize: scaledFont(16),
        fill: this._accent,
      },
    });
    this.iconTxt.eventMode = "none";
    this.iconTxt.anchor.set(0.5, 0.5);

    this.labelTxt = new Text({
      text: label,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(14),
        fill: this._accent,
        fontWeight: "bold",
      },
    });
    this.labelTxt.eventMode = "none";
    this.labelTxt.anchor.set(0, 0.5);
    this.labelTxt.y = btnH / 2;

    this.container.addChild(this.bg);
    this.container.addChild(this.strip);
    this.container.addChild(this.iconTxt);
    this.container.addChild(this.labelTxt);

    this._layout();
    this._drawNormal();

    this.container.eventMode = "static";
    this.container.cursor = "pointer";
    const ha = touchHitArea(btnW, btnH);
    this.container.hitArea = new Rectangle(ha.x, ha.y, ha.width, ha.height);

    this.container.on("pointerdown", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const native = event.nativeEvent as
        | { stopPropagation?: () => void }
        | undefined;
      if (typeof native?.stopPropagation === "function") {
        native.stopPropagation();
      }
      this._drawActive();
      onClick(event);
    });
    this.container.on("pointerup", () => this._drawNormal());
    this.container.on("pointerupoutside", () => this._drawNormal());
    this.container.on("pointerover", () => this._drawHover());
    this.container.on("pointerout", () => this._drawNormal());
  }

  get x(): number {
    return this.container.x;
  }
  set x(v: number) {
    this.container.x = v;
  }
  get y(): number {
    return this.container.y;
  }
  set y(v: number) {
    this.container.y = v;
  }
  get visible(): boolean {
    return this.container.visible;
  }
  set visible(v: boolean) {
    this.container.visible = v;
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    this.container.on(event, handler);
    return this;
  }

  setLabel(text: string): void {
    this.labelTxt.text = text;
  }

  setAccentColor(color: number): void {
    this._accent = color;
    this.iconTxt.style.fill = color;
    this.labelTxt.style.fill = color;
    this._drawNormal();
  }

  private _layout(): void {
    const hasIcon = this.iconTxt.text.length > 0;
    const hasLabel = this.labelTxt.text.length > 0;

    if (hasIcon && !hasLabel) {
      this.iconTxt.x = this.btnW / 2;
      this.iconTxt.y = this.btnH / 2;
      this.labelTxt.visible = false;
    } else if (!hasIcon && hasLabel) {
      this.labelTxt.x = 10;
      this.iconTxt.visible = false;
    } else {
      this.iconTxt.x = 16;
      this.iconTxt.y = this.btnH / 2;
      this.labelTxt.x = 32;
    }
  }

  private _drawNormal(): void {
    const c = this._accent;
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.btnW, this.btnH, 4)
      .fill({ color: 0x0a1428, alpha: 0.92 });
    this.bg
      .roundRect(0, 0, this.btnW, this.btnH, 4)
      .stroke({ color: c, width: 1 });
    this.strip.clear();
    this.strip.rect(0, 4, 4, this.btnH - 8).fill({ color: c, alpha: 0.9 });
  }

  private _drawHover(): void {
    const c = this._accent;
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.btnW, this.btnH, 4)
      .fill({ color: c, alpha: 0.18 });
    this.bg
      .roundRect(0, 0, this.btnW, this.btnH, 4)
      .stroke({ color: c, width: 2 });
    this.strip.clear();
    this.strip.rect(0, 4, 4, this.btnH - 8).fill({ color: c, alpha: 0.9 });
  }

  private _drawActive(): void {
    const c = this._accent;
    this.bg.clear();
    this.bg
      .roundRect(0, 0, this.btnW, this.btnH, 4)
      .fill({ color: c, alpha: 0.35 });
    this.bg
      .roundRect(0, 0, this.btnW, this.btnH, 4)
      .stroke({ color: c, width: 2 });
    this.strip.clear();
    this.strip.rect(0, 4, 4, this.btnH - 8).fill({ color: c, alpha: 0.9 });
  }
}
