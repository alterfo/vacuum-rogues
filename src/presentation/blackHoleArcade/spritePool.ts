import { Sprite, type Container, type Texture } from "pixi.js";

export class SpritePool {
  private free: Sprite[] = [];
  private active = new Map<number, Sprite>();
  private used = new Set<number>();

  constructor(
    private readonly layer: Container,
    private readonly additive = false,
  ) {}

  begin(): void {
    this.used.clear();
  }

  use(id: number, texture: Texture): Sprite {
    let sprite = this.active.get(id);
    if (!sprite) {
      sprite = this.free.pop() ?? this.create();
      sprite.visible = true;
      sprite.tint = 0xffffff;
      sprite.alpha = 1;
      sprite.rotation = 0;
      sprite.scale.set(1);
      this.active.set(id, sprite);
    }
    if (sprite.texture !== texture) sprite.texture = texture;
    this.used.add(id);
    return sprite;
  }

  end(): void {
    for (const [id, sprite] of this.active) {
      if (this.used.has(id)) continue;
      sprite.visible = false;
      this.active.delete(id);
      this.free.push(sprite);
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  destroy(): void {
    for (const sprite of this.active.values()) sprite.destroy();
    for (const sprite of this.free) sprite.destroy();
    this.active.clear();
    this.free.length = 0;
  }

  private create(): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    if (this.additive) sprite.blendMode = "add";
    this.layer.addChild(sprite);
    return sprite;
  }
}
