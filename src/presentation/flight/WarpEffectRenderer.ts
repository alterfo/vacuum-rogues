import { Container, Graphics, BlurFilter } from "pixi.js";

interface WarpArrivalEffect {
  container: Container;
  rings: Graphics[];
  flash: Graphics;
  glow: Graphics;
  elapsed: number;
  duration: number;
}

export class WarpEffectRenderer {
  private warpEffect: WarpArrivalEffect | null = null;
  private readonly ringColors = [0xffffff, 0x9fe8ff, 0x77aaff];

  constructor(private readonly gameLayer: Container) {}

  private paddedBlur(strength: number): BlurFilter {
    const f = new BlurFilter({ strength });
    f.padding = Math.ceil(strength * 3 + 24);
    f.resolution = 1;
    return f;
  }

  play(x: number, y: number): void {
    const container = new Container();
    container.x = x;
    container.y = y;

    const color = 0x9fe8ff;

    const glow = new Graphics();
    glow.circle(0, 0, 90).fill({ color, alpha: 0.0 });
    glow.filters = [this.paddedBlur(24)];
    container.addChild(glow);

    const flash = new Graphics();
    flash.circle(0, 0, 60).fill({ color: 0xffffff, alpha: 1 });
    flash.filters = [this.paddedBlur(12)];
    container.addChild(flash);

    const rings: Graphics[] = [];
    for (let i = 0; i < this.ringColors.length; i++) {
      const ring = new Graphics();
      ring.circle(0, 0, 20).stroke({
        width: 5 - i,
        color: this.ringColors[i],
        alpha: 0.95,
      });
      container.addChild(ring);
      rings.push(ring);
    }

    this.gameLayer.addChild(container);
    this.warpEffect = {
      container,
      rings,
      flash,
      glow,
      elapsed: 0,
      duration: 1100,
    };
  }

  private disposeEffectFilters(fx: WarpArrivalEffect): void {
    for (const node of [fx.flash, fx.glow]) {
      const fs = node.filters;
      const arr = Array.isArray(fs) ? fs : fs ? [fs] : [];
      for (const f of arr) f.destroy?.();
    }
  }

  update(deltaTime: number): void {
    const fx = this.warpEffect;
    if (!fx) return;

    fx.elapsed += deltaTime;
    const t = Math.min(1, fx.elapsed / fx.duration);

    fx.flash.alpha = Math.max(0, Math.pow(1 - t, 1.8));
    fx.flash.scale.set(0.7 + t * 1.1);

    fx.glow.alpha = Math.sin(t * Math.PI) * 0.7;
    fx.glow.scale.set(0.6 + t * 1.4);

    fx.rings.forEach((ring, i) => {
      const rt = Math.max(0, Math.min(1, t * 1.3 - i * 0.18));
      const eased = 1 - Math.pow(1 - rt, 2);
      ring.scale.set(0.2 + eased * 8);
      ring.alpha = Math.max(0, 1 - rt) * (0.95 - i * 0.12);
    });

    if (t >= 1) {
      this.disposeEffectFilters(fx);
      this.gameLayer.removeChild(fx.container);
      fx.container.destroy({ children: true });
      this.warpEffect = null;
    }
  }

  get isActive(): boolean {
    return this.warpEffect !== null;
  }

  destroy(): void {
    const fx = this.warpEffect;
    if (fx) {
      this.disposeEffectFilters(fx);
      this.gameLayer.removeChild(fx.container);
      fx.container.destroy({ children: true });
      this.warpEffect = null;
    }
  }
}
