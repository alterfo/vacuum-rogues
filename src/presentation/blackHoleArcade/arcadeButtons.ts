import { Container, Graphics, Sprite, type Text } from "pixi.js";
import { scaledText } from "../ui/scaledText";
import type { ArcadeArt } from "./arcadeArt";

export interface ArcadeButtonCallbacks {
  onSound(): void;
  onPause(): void;
  onBomb(): void;
  onUiPointer(pointerId: number): void;
}

export interface ArcadeButtonsState {
  soundOn: boolean;
  bombs: number;
  touch: boolean;
  controlsVisible: boolean;
  paused: boolean;
}

const EDGE = 0x8d84ad;
const EDGE_ON = 0x5eea7a;
const EDGE_OFF = 0xf87171;
const BODY = 0x120d2a;
const SOUND_R = 24;
const PAUSE_R = 24;
const BOMB_R = 40;
const MARGIN = 16;
const FEEDBACK_BUTTON_CLEARANCE = 72;

interface Btn {
  root: Container;
  bg: Graphics;
  icon: Graphics;
}

export class ArcadeButtons {
  readonly root = new Container();
  private sound: Btn;
  private pause: Btn;
  private bomb: Btn;
  private bombIcon: Sprite;
  private bombCount: Text;
  private lastKey = "";

  constructor(
    art: ArcadeArt,
    private readonly cb: ArcadeButtonCallbacks,
  ) {
    this.sound = this.make(SOUND_R, () => this.cb.onSound());
    this.pause = this.make(PAUSE_R, () => this.cb.onPause());
    this.bomb = this.make(BOMB_R, () => this.cb.onBomb());
    this.bombIcon = new Sprite(art.pickups.bomb);
    this.bombIcon.anchor.set(0.5);
    this.bombIcon.eventMode = "none";
    this.bombIcon.width = this.bombIcon.height = 54;
    this.bomb.root.addChild(this.bombIcon);
    this.bombCount = scaledText("0", 16, 0xffffff, {
      rawColor: true,
      fontWeight: "bold",
    });
    this.bombCount.anchor.set(0.5);
    this.bombCount.x = BOMB_R - 6;
    this.bombCount.y = BOMB_R - 6;
    this.bombCount.eventMode = "none";
    this.bomb.root.addChild(this.bombCount);
    this.root.addChild(this.sound.root, this.pause.root, this.bomb.root);
  }

  private make(radius: number, onTap: () => void): Btn {
    const root = new Container();
    const bg = new Graphics();
    const icon = new Graphics();
    icon.eventMode = "none";
    root.addChild(bg, icon);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointerdown", (event) => {
      event.stopPropagation();
      this.cb.onUiPointer(event.pointerId);
      onTap();
    });
    bg.circle(0, 0, radius).fill({ color: BODY, alpha: 0.78 });
    bg.circle(0, 0, radius).stroke({ color: EDGE, width: 2, alpha: 0.9 });
    return { root, bg, icon };
  }

  layout(width: number, height: number, touch: boolean): void {
    this.sound.root.x = MARGIN + SOUND_R;
    this.sound.root.y = height - MARGIN - SOUND_R;
    this.pause.root.x = MARGIN + SOUND_R * 2 + 14 + PAUSE_R;
    this.pause.root.y = this.sound.root.y;
    this.bomb.root.x = width - MARGIN - BOMB_R;
    this.bomb.root.y =
      height - MARGIN - BOMB_R - (touch ? FEEDBACK_BUTTON_CLEARANCE : 0);
    this.lastKey = "";
  }

  update(state: ArcadeButtonsState): void {
    this.sound.root.visible = true;
    this.pause.root.visible = state.touch && state.controlsVisible;
    this.bomb.root.visible = state.touch && state.controlsVisible;

    const key = `${state.soundOn}|${state.bombs}|${state.paused}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.drawSound(state.soundOn);
    this.drawPause(state.paused);
    this.bombCount.text = String(state.bombs);
    this.bomb.bg.clear();
    this.bomb.bg.circle(0, 0, BOMB_R).fill({ color: BODY, alpha: 0.78 });
    this.bomb.bg.circle(0, 0, BOMB_R).stroke({
      color: state.bombs > 0 ? EDGE_OFF : EDGE,
      width: 3,
      alpha: state.bombs > 0 ? 1 : 0.5,
    });
    this.bombIcon.alpha = state.bombs > 0 ? 1 : 0.35;
  }

  private drawSound(on: boolean): void {
    const g = this.sound.icon;
    const color = on ? EDGE_ON : EDGE;
    g.clear();
    this.sound.bg.clear();
    this.sound.bg.circle(0, 0, SOUND_R).fill({ color: BODY, alpha: 0.78 });
    this.sound.bg.circle(0, 0, SOUND_R).stroke({
      color: on ? EDGE_ON : EDGE_OFF,
      width: 2,
      alpha: 0.95,
    });
    g.poly([-11, -5, -5, -5, 2, -11, 2, 11, -5, 5, -11, 5]).fill({ color });
    if (on) {
      g.arc(3, 0, 6, -0.9, 0.9).stroke({ color, width: 2 });
      g.arc(3, 0, 11, -0.9, 0.9).stroke({ color, width: 2 });
    } else {
      g.moveTo(-14, -14).lineTo(14, 14).stroke({ color: EDGE_OFF, width: 3 });
    }
  }

  private drawPause(paused: boolean): void {
    const g = this.pause.icon;
    g.clear();
    if (paused) {
      g.poly([-6, -10, 11, 0, -6, 10]).fill({ color: EDGE_ON });
    } else {
      g.rect(-8, -9, 5, 18).fill({ color: 0xe8e2ff });
      g.rect(3, -9, 5, 18).fill({ color: 0xe8e2ff });
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
