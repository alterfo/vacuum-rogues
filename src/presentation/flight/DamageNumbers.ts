import { Container, Text } from "pixi.js";
import { scaledFont } from "@/utils/fontScale";

/** One floating number: its Text, accumulated age (s) and the spawn Y it rises from. */
interface FloatingNumber {
  text: Text;
  age: number;
  baseY: number;
}

/** Lifetime of a floating number (seconds) and how far it rises over that life. */
const FLOAT_DURATION_S = 0.8;
const RISE_PX = 36;

/** Yellow = damage the player dealt; red = damage the player took. */
const DEALT_COLOR = 0xffdd33;
const TAKEN_COLOR = 0xff4444;

/**
 * Floating combat damage numbers (Task 13). Each number is a PixiJS {@link Text}
 * mounted on the world (game) layer so it pans/zooms with the battle; it floats
 * upward and fades over {@link FLOAT_DURATION_S}, then removes itself. The helper
 * owns its display objects and is driven by {@link CombatModule.update}.
 */
export class DamageNumbers {
  private readonly layer: Container;
  private readonly active: FloatingNumber[] = [];

  constructor(layer: Container) {
    this.layer = layer;
  }

  /** Number of numbers still floating (test/debug helper). */
  get activeCount(): number {
    return this.active.length;
  }

  /**
   * Spawn a number at a world position. `dealt` → yellow (player hit the NPC),
   * otherwise red (player took the hit).
   */
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

  /** Advance every active number: float up + fade; self-remove when expired. */
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
      n.text.y = n.baseY - RISE_PX * t; // float upward (screen-up = -Y)
      n.text.alpha = 1 - t;
    }
  }

  /** Tear down every active number (combat end / scene teardown). */
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
