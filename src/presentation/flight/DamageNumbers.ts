import { Container, Text } from "pixi.js";
import { scaledFont } from "@/utils/fontScale";

interface FloatingNumber {
  text: Text;
  age: number;
  baseY: number;
}

const FLOAT_DURATION_S = 0.8;
const RISE_PX = 36;

const DEALT_COLOR = 0xffdd33;
const TAKEN_COLOR = 0xff4444;

export interface DamageNumberMotion {
  yOffset: number;
  alpha: number;
  scale: number;
}

export function damageNumberMotion(t: number): DamageNumberMotion {
  const clamped = Math.max(0, Math.min(1, t));
  const eased = 1 - Math.pow(1 - clamped, 3);
  return {
    yOffset: RISE_PX * eased,
    alpha: clamped >= 1 ? 0 : 1 - clamped * clamped,
    scale: 1 + 0.24 * Math.sin(clamped * Math.PI),
  };
}

export class DamageNumbers {
  private readonly layer: Container;
  private readonly active: FloatingNumber[] = [];

  constructor(layer: Container) {
    this.layer = layer;
  }

  get activeCount(): number {
    return this.active.length;
  }

  spawn(amount: number, worldX: number, worldY: number, dealt: boolean): void {
    const text = new Text({
      text: `-${Math.round(amount)}`,
      style: {
        fontFamily: "Courier New",
        fontSize: scaledFont(16),
        fill: dealt ? DEALT_COLOR : TAKEN_COLOR,
        fontWeight: "bold",
      },
    });
    text.anchor.set(0.5);
    text.x = worldX;
    text.y = worldY;
    text.eventMode = "none";
    text.zIndex = 200; // above ships (100) and loot (90)
    this.layer.addChild(text);
    this.active.push({ text, age: 0, baseY: worldY });
  }

  update(deltaTimeMs: number): void {
    const dt = deltaTimeMs / 1000;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const n = this.active[i];
      n.age += dt;
      const t = n.age / FLOAT_DURATION_S;
      if (t >= 1) {
        this.remove(i);
        continue;
      }
      const motion = damageNumberMotion(t);
      n.text.y = n.baseY - motion.yOffset;
      n.text.alpha = motion.alpha;
      n.text.scale.set(motion.scale);
    }
  }

  clear(): void {
    for (let i = this.active.length - 1; i >= 0; i--) this.remove(i);
  }

  private remove(i: number): void {
    const n = this.active[i];
    if (n.text.parent) n.text.parent.removeChild(n.text);
    if (!n.text.destroyed) n.text.destroy();
    this.active.splice(i, 1);
  }
}
