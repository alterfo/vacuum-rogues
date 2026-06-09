import { Container, Graphics, BlurFilter } from "pixi.js";

interface WarpArrivalEffect {
  container: Container;
  rings: Graphics[];
  flash: Graphics;
  glow: Graphics;
  elapsed: number;
  duration: number;
}

/**
 * Warp-exit flourish (US-043): a bright flash, expanding shock rings and a
 * lingering glow at the point where the ship drops out of hyperspace. Extracted
 * from SpaceFlightScene as a self-contained visual decoration — the scene just
 * calls {@link play} on arrival and {@link update} each frame. Owns its single
 * transient effect container on the game layer (Information Expert / SRP).
 */
export class WarpEffectRenderer {
  private warpEffect: WarpArrivalEffect | null = null;

  constructor(private readonly gameLayer: Container) {}

  /**
   * A BlurFilter with generous padding. PixiJS renders a filter into a texture
   * sized to the object's bounds + padding; if the padding is too small the
   * blur is clipped at the texture edge and shows as a hard rectangular band —
   * especially once the gameLayer is scaled by the camera zoom. Padding ~2×
   * the blur strength keeps the falloff inside the texture so no edge appears.
   */
  private paddedBlur(strength: number): BlurFilter {
    const f = new BlurFilter({ strength });
    f.padding = Math.ceil(strength * 3 + 24);
    f.resolution = 1;
    return f;
  }

  /** Spawn the warp-exit flourish at a world point. Replaces any active effect. */
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
    for (let i = 0; i < 3; i++) {
      const ring = new Graphics();
      ring.circle(0, 0, 20).stroke({ width: 4, color, alpha: 0.9 });
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

  /** Animate the warp-exit flash + expanding rings, then clean up. */
  update(deltaTime: number): void {
    const fx = this.warpEffect;
    if (!fx) return;

    fx.elapsed += deltaTime;
    const t = Math.min(1, fx.elapsed / fx.duration);

    // Flash: bright then fades fast.
    fx.flash.alpha = Math.max(0, 1 - t * 2.2);
    fx.flash.scale.set(1 + t * 0.6);

    // Glow: swells in, fades out over the full duration.
    fx.glow.alpha = Math.sin(t * Math.PI) * 0.6;
    fx.glow.scale.set(0.6 + t * 1.4);

    // Rings: staggered expansion outward, thinning as they grow.
    fx.rings.forEach((ring, i) => {
      const rt = Math.max(0, Math.min(1, t * 1.3 - i * 0.18));
      ring.scale.set(0.2 + rt * 8);
      ring.alpha = Math.max(0, 1 - rt) * 0.9;
    });

    if (t >= 1) {
      this.gameLayer.removeChild(fx.container);
      fx.container.destroy({ children: true });
      this.warpEffect = null;
    }
  }

  /** True while an effect is mid-animation (for tests / state checks). */
  get isActive(): boolean {
    return this.warpEffect !== null;
  }

  /** Tear down any in-flight effect (called from the scene's destroy()). */
  destroy(): void {
    const fx = this.warpEffect;
    if (fx) {
      this.gameLayer.removeChild(fx.container);
      fx.container.destroy({ children: true });
      this.warpEffect = null;
    }
  }
}
