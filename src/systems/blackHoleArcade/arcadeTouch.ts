export interface TouchBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const ARCADE_TOUCH_GAIN = 1.2;

export class RelativeDrag {
  private id: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private targetX = 0;
  private targetY = 0;

  constructor(private readonly gain: number = ARCADE_TOUCH_GAIN) {}

  get activeId(): number | null {
    return this.id;
  }

  begin(
    id: number,
    px: number,
    py: number,
    shipX: number,
    shipY: number,
  ): void {
    this.id = id;
    this.lastX = px;
    this.lastY = py;
    this.targetX = shipX;
    this.targetY = shipY;
  }

  move(
    id: number,
    px: number,
    py: number,
    scale: number,
    bounds: TouchBounds,
  ): { x: number; y: number } | null {
    if (this.id !== id || scale <= 0) return null;
    const factor = this.gain / scale;
    this.targetX = Math.min(
      bounds.maxX,
      Math.max(bounds.minX, this.targetX + (px - this.lastX) * factor),
    );
    this.targetY = Math.min(
      bounds.maxY,
      Math.max(bounds.minY, this.targetY + (py - this.lastY) * factor),
    );
    this.lastX = px;
    this.lastY = py;
    return { x: this.targetX, y: this.targetY };
  }

  end(id: number): boolean {
    if (this.id !== id) return false;
    this.id = null;
    return true;
  }
}

export interface FxQuality {
  particleCap: number;
  sparkScale: number;
  shadows: boolean;
  auras: boolean;
  shake: number;
}

export const ARCADE_FX_QUALITY: readonly FxQuality[] = [
  { particleCap: 420, sparkScale: 1, shadows: true, auras: true, shake: 1 },
  { particleCap: 240, sparkScale: 0.6, shadows: true, auras: true, shake: 0.8 },
  {
    particleCap: 100,
    sparkScale: 0.3,
    shadows: false,
    auras: false,
    shake: 0.5,
  },
];

export const ARCADE_QUALITY_MAX_LEVEL = ARCADE_FX_QUALITY.length - 1;

const SLOW_FRAME_MS = 24;
const SPIKE_MS = 250;
const SLOW_STREAK_FRAMES = 60;
const COOLDOWN_FRAMES = 180;
const EMA_ALPHA = 0.08;

export class AdaptiveQuality {
  private ema = 16.7;
  private slowStreak = 0;
  private cooldown = 0;
  level: number;

  constructor(initial = 0) {
    this.level = Math.min(ARCADE_QUALITY_MAX_LEVEL, Math.max(0, initial));
  }

  sample(frameMs: number): number {
    if (frameMs <= 0 || frameMs > SPIKE_MS) return this.level;
    this.ema += (frameMs - this.ema) * EMA_ALPHA;
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return this.level;
    }
    this.slowStreak = this.ema > SLOW_FRAME_MS ? this.slowStreak + 1 : 0;
    if (
      this.slowStreak >= SLOW_STREAK_FRAMES &&
      this.level < ARCADE_QUALITY_MAX_LEVEL
    ) {
      this.level += 1;
      this.slowStreak = 0;
      this.cooldown = COOLDOWN_FRAMES;
      this.ema = 16.7;
    }
    return this.level;
  }
}
