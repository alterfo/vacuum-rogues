class Vec2 {
  x = 0;
  y = 0;
  set(x = 0, y = x): this {
    this.x = x;
    this.y = y;
    return this;
  }
  copyFrom(p: { x: number; y: number }): this {
    this.x = p.x;
    this.y = p.y;
    return this;
  }
}

class DisplayObjectStub {
  children: unknown[] = [];
  filters: unknown[] | null = [];
  position = new Vec2();
  scale = new Vec2();
  pivot = new Vec2();
  skew = new Vec2();
  anchor = new Vec2();
  tilePosition = new Vec2();
  tileScale = new Vec2();
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  alpha = 1;
  rotation = 0;
  angle = 0;
  visible = true;
  renderable = true;
  eventMode = "auto";
  cursor = "auto";
  tint = 0xffffff;
  zIndex = 0;
  blendMode = "normal";
  roundPixels = false;
  sortableChildren = false;
  interactive = false;
  mask: unknown = null;
  hitArea: unknown = null;
  parent: unknown = null;
  label = "";

  addChild(...kids: unknown[]): unknown {
    for (const kid of kids) {
      this.children.push(kid);
      if (kid && typeof kid === "object") {
        (kid as { parent?: unknown }).parent = this;
      }
    }
    return kids[0];
  }
  addChildAt(kid: unknown): unknown {
    this.children.unshift(kid);
    if (kid && typeof kid === "object")
      (kid as { parent?: unknown }).parent = this;
    return kid;
  }
  removeChild(...kids: unknown[]): unknown {
    for (const kid of kids) {
      const i = this.children.indexOf(kid);
      if (i >= 0) this.children.splice(i, 1);
    }
    return kids[0];
  }
  removeChildAt(index: number): unknown {
    const [kid] = this.children.splice(index, 1);
    return kid;
  }
  removeChildren(): unknown[] {
    const removed = this.children;
    this.children = [];
    return removed;
  }
  removeFromParent(): void {
    const parent = this.parent as { removeChild?: (c: unknown) => void } | null;
    parent?.removeChild?.(this);
  }
  getChildByLabel(): unknown {
    return undefined;
  }
  getChildByName(): unknown {
    return undefined;
  }
  setChildIndex(): void {}
  getChildIndex(): number {
    return 0;
  }
  swapChildren(): void {}
  toLocal(p: unknown): unknown {
    return p;
  }
  toGlobal(p: unknown): unknown {
    return p;
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }
  getLocalBounds(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }
  cacheAsTexture(): void {}
  updateTransform(): this {
    return this;
  }
  on(): this {
    return this;
  }
  once(): this {
    return this;
  }
  off(): this {
    return this;
  }
  emit(): this {
    return this;
  }
  removeAllListeners(): this {
    return this;
  }
  destroy(): void {}
}

class ContainerStub extends DisplayObjectStub {}

class GraphicsStub extends DisplayObjectStub {
  fill(): this {
    return this;
  }
  stroke(): this {
    return this;
  }
  setStrokeStyle(): this {
    return this;
  }
  setFillStyle(): this {
    return this;
  }
  rect(): this {
    return this;
  }
  roundRect(): this {
    return this;
  }
  circle(): this {
    return this;
  }
  ellipse(): this {
    return this;
  }
  poly(): this {
    return this;
  }
  star(): this {
    return this;
  }
  moveTo(): this {
    return this;
  }
  lineTo(): this {
    return this;
  }
  arc(): this {
    return this;
  }
  arcTo(): this {
    return this;
  }
  bezierCurveTo(): this {
    return this;
  }
  quadraticCurveTo(): this {
    return this;
  }
  closePath(): this {
    return this;
  }
  beginPath(): this {
    return this;
  }
  clear(): this {
    return this;
  }
  texture(): this {
    return this;
  }
  cut(): this {
    return this;
  }
  lineStyle(): this {
    return this;
  }
  beginFill(): this {
    return this;
  }
  endFill(): this {
    return this;
  }
  drawRect(): this {
    return this;
  }
  drawCircle(): this {
    return this;
  }
  drawRoundedRect(): this {
    return this;
  }
  drawPolygon(): this {
    return this;
  }
}

class TextStub extends DisplayObjectStub {
  text = "";
  style: Record<string, unknown> = {};
  resolution = 1;
  constructor(
    opts?: { text?: string; style?: Record<string, unknown> } | string,
  ) {
    super();
    if (typeof opts === "string") {
      this.text = opts;
    } else if (opts) {
      this.text = opts.text ?? "";
      this.style = opts.style ?? {};
    }
  }
}

class TextureSourceStub {
  width = 1;
  height = 1;
  resource: unknown = null;
  destroy(): void {}
}

class TextureStub {
  static WHITE = new TextureStub();
  static EMPTY = new TextureStub();
  static from(): TextureStub {
    return new TextureStub();
  }
  width = 1;
  height = 1;
  source = new TextureSourceStub();
  orig = { width: 1, height: 1 };
  frame = { x: 0, y: 0, width: 1, height: 1 };
  destroy(): void {}
}

class SpriteStub extends DisplayObjectStub {
  texture: unknown;
  static from(): SpriteStub {
    return new SpriteStub();
  }
  constructor(texture?: unknown) {
    super();
    this.texture = texture ?? new TextureStub();
    this.width = 1;
    this.height = 1;
  }
}

class TilingSpriteStub extends DisplayObjectStub {
  texture: unknown;
  static from(): TilingSpriteStub {
    return new TilingSpriteStub();
  }
  constructor(opts?: { texture?: unknown }) {
    super();
    this.texture = opts?.texture ?? new TextureStub();
  }
}

class MeshStub extends DisplayObjectStub {
  geometry: unknown;
  shader: unknown;
  constructor(opts?: { geometry?: unknown; shader?: unknown }) {
    super();
    this.geometry = opts?.geometry ?? null;
    this.shader = opts?.shader ?? null;
  }
}

class ParticleStub {
  texture: unknown;
  x = 0;
  y = 0;
  scaleX = 1;
  scaleY = 1;
  anchorX = 0.5;
  anchorY = 0.5;
  alpha = 1;
  rotation = 0;
  tint = 0xffffff;
  constructor(
    opts: {
      texture?: unknown;
      x?: number;
      y?: number;
      alpha?: number;
      anchorX?: number;
      anchorY?: number;
      tint?: number;
    } = {},
  ) {
    this.texture = opts.texture ?? new TextureStub();
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.alpha = opts.alpha ?? 1;
    this.anchorX = opts.anchorX ?? 0.5;
    this.anchorY = opts.anchorY ?? 0.5;
    this.tint = opts.tint ?? 0xffffff;
  }
}

class ParticleContainerStub extends DisplayObjectStub {
  particleChildren: unknown[] = [];
  constructor(_opts?: unknown) {
    super();
  }
  addParticle(particle: unknown): unknown {
    this.particleChildren.push(particle);
    return particle;
  }
  removeParticle(particle: unknown): void {
    const i = this.particleChildren.indexOf(particle);
    if (i >= 0) this.particleChildren.splice(i, 1);
  }
  removeParticles(): void {
    this.particleChildren = [];
  }
  update(): void {}
}

class FilterStub {
  resources: Record<string, unknown> = {};
  uniforms: Record<string, unknown> = {};
  enabled = true;
  padding = 0;
  constructor(..._args: unknown[]) {}
  apply(): void {}
  destroy(): void {}
}

class BlurFilterStub extends FilterStub {
  blur = 0;
  quality = 1;
}

class ColorMatrixFilterStub extends FilterStub {
  matrix: number[] = [];
  alpha = 1;
  brightness(): void {}
  contrast(): void {}
  saturate(): void {}
  desaturate(): void {}
  hue(): void {}
  tint(): void {}
  reset(): void {}
}

class MeshGeometryStub {
  attributes: Record<string, unknown> = {};
  constructor(_opts?: unknown) {}
  getBuffer(): { data: Float32Array; update(): void } {
    return { data: new Float32Array(0), update(): void {} };
  }
  getAttribute(): Record<string, unknown> {
    return {};
  }
  getIndex(): Record<string, unknown> {
    return {};
  }
  destroy(): void {}
}

class GlProgramStub {
  constructor(_opts?: unknown) {}
  static from(): GlProgramStub {
    return new GlProgramStub();
  }
}

class UniformGroupStub {
  uniforms: Record<string, unknown>;
  constructor(uniforms: Record<string, unknown> = {}) {
    this.uniforms = uniforms;
  }
}

class BufferStub {
  data: unknown;
  constructor(opts?: { data?: unknown }) {
    this.data = opts?.data ?? null;
  }
  update(): void {}
  destroy(): void {}
}

class RectangleStub {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  contains(px: number, py: number): boolean {
    return (
      px >= this.x &&
      px <= this.x + this.width &&
      py >= this.y &&
      py <= this.y + this.height
    );
  }
  clone(): RectangleStub {
    return new RectangleStub(this.x, this.y, this.width, this.height);
  }
}

class CircleStub {
  constructor(
    public x = 0,
    public y = 0,
    public radius = 0,
  ) {}
  contains(px: number, py: number): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }
}

class PointStub {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  set(x = 0, y = x): this {
    this.x = x;
    this.y = y;
    return this;
  }
}

class FederatedPointerEventStub {
  global = new PointStub();
  client = new PointStub();
  screen = new PointStub();
  button = 0;
  buttons = 0;
  stopPropagation(): void {}
  preventDefault(): void {}
}

class TickerStub {
  static shared = new TickerStub();
  add(): this {
    return this;
  }
  addOnce(): this {
    return this;
  }
  remove(): this {
    return this;
  }
  start(): void {}
  stop(): void {}
}

class ApplicationStub {
  canvas: HTMLCanvasElement =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : ({} as HTMLCanvasElement);
  screen = { width: 1280, height: 720 };
  renderer = {
    type: "webgl",
    width: 1280,
    height: 720,
    resize(): void {},
    generateTexture(): TextureStub {
      return new TextureStub();
    },
    extract: {
      canvas: (): HTMLCanvasElement =>
        typeof document !== "undefined"
          ? document.createElement("canvas")
          : ({} as HTMLCanvasElement),
    },
  };
  stage = new ContainerStub();
  ticker = new TickerStub();
  async init(): Promise<void> {}
  destroy(): void {}
}

const AssetsStub = {
  async load(): Promise<TextureStub> {
    return new TextureStub();
  },
  get(): TextureStub | undefined {
    return undefined;
  },
  add(): void {},
  async unload(): Promise<void> {},
  cache: {
    has(): boolean {
      return false;
    },
    get(): undefined {
      return undefined;
    },
  },
};

export function makePixiStub(): Record<string, unknown> {
  return {
    Application: ApplicationStub,
    Assets: AssetsStub,
    Container: ContainerStub,
    Graphics: GraphicsStub,
    Text: TextStub,
    Sprite: SpriteStub,
    TilingSprite: TilingSpriteStub,
    Mesh: MeshStub,
    MeshGeometry: MeshGeometryStub,
    Particle: ParticleStub,
    ParticleContainer: ParticleContainerStub,
    Texture: TextureStub,
    TextureSource: TextureSourceStub,
    Filter: FilterStub,
    BlurFilter: BlurFilterStub,
    ColorMatrixFilter: ColorMatrixFilterStub,
    GlProgram: GlProgramStub,
    UniformGroup: UniformGroupStub,
    Buffer: BufferStub,
    Rectangle: RectangleStub,
    Circle: CircleStub,
    Point: PointStub,
    FederatedPointerEvent: FederatedPointerEventStub,
    Ticker: TickerStub,
  };
}
