import type { Page } from '@playwright/test';

interface MonkeyBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MonkeyOptions {
  delayMs?: number;
  types?: Array<'leftClick' | 'rightClick' | 'scroll' | 'key'>;
  bounds?: MonkeyBounds;
}

interface MonkeyResult {
  actions: number;
  errors: string[];
}

const MONKEY_WEIGHTS = { leftClick: 60, rightClick: 20, scroll: 15, key: 5 };
const MONKEY_KEYS = ['Escape', ' ', 'Tab'];

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}

export class MonkeyTester {
  private rng: SeededRandom;

  constructor(
    private page: Page,
    seed = 42
  ) {
    this.rng = new SeededRandom(seed);
  }

  nextFloat(): number {
    return this.rng.next();
  }

  private async getCanvasBounds(): Promise<MonkeyBounds> {
    const box = await this.page.locator('canvas').boundingBox();
    if (!box) return { x: 0, y: 0, w: 800, h: 600 };
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }

  async randomClick(bounds?: MonkeyBounds): Promise<void> {
    const b = bounds ?? (await this.getCanvasBounds());
    const x = b.x + this.nextFloat() * b.w;
    const y = b.y + this.nextFloat() * b.h;
    await this.page.mouse.click(x, y, { button: 'left' });
  }

  async randomRightClick(bounds?: MonkeyBounds): Promise<void> {
    const b = bounds ?? (await this.getCanvasBounds());
    const x = b.x + this.nextFloat() * b.w;
    const y = b.y + this.nextFloat() * b.h;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down({ button: 'right' });
    const dx = (this.nextFloat() - 0.5) * 100;
    const dy = (this.nextFloat() - 0.5) * 100;
    await this.page.mouse.move(x + dx, y + dy);
    await this.page.mouse.up({ button: 'right' });
  }

  async randomScroll(delta?: number): Promise<void> {
    const b = await this.getCanvasBounds();
    const x = b.x + this.nextFloat() * b.w;
    const y = b.y + this.nextFloat() * b.h;
    const deltaY = delta ?? (this.nextFloat() * 600 - 300);
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(0, deltaY);
  }

  async randomKey(keys: string[] = MONKEY_KEYS): Promise<void> {
    const key = keys[Math.floor(this.nextFloat() * keys.length)];
    await this.page.keyboard.press(key);
  }

  private pickAction(types?: MonkeyOptions['types']): 'leftClick' | 'rightClick' | 'scroll' | 'key' {
    const allowed = types ?? (['leftClick', 'rightClick', 'scroll', 'key'] as const);
    const weights = allowed.map((t) => MONKEY_WEIGHTS[t]);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.nextFloat() * total;
    for (let i = 0; i < allowed.length; i++) {
      r -= weights[i];
      if (r <= 0) return allowed[i];
    }
    return allowed[allowed.length - 1];
  }

  async run(n: number, opts: MonkeyOptions = {}): Promise<MonkeyResult> {
    const { delayMs = 50, types, bounds } = opts;
    const errors: string[] = [];
    let actions = 0;

    for (let i = 0; i < n; i++) {
      const action = this.pickAction(types);
      try {
        if (action === 'leftClick') await this.randomClick(bounds);
        else if (action === 'rightClick') await this.randomRightClick(bounds);
        else if (action === 'scroll') await this.randomScroll();
        else await this.randomKey();
        actions++;
      } catch (err) {
        errors.push(String(err));
      }
      if (delayMs > 0) {
        await this.page.waitForTimeout(delayMs);
      }
    }

    return { actions, errors };
  }
}
