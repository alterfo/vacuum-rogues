import { Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import {
  ARCADE_FIELD_H,
  ARCADE_FIELD_W,
} from "@/systems/blackHoleArcade/arcadeConfig";
import { ARCADE_THEMES, type ArcadeArt } from "./arcadeArt";

const TERRAIN_TILE = 512;

export class ArcadeBackground {
  readonly screen = new Container();
  readonly field = new Container();
  private base = new Graphics();
  private starLayers: TilingSprite[];
  private nebulae: Sprite[] = [];
  private disc: Sprite;
  private terrain: TilingSprite;
  private edgeGlow = new Graphics();
  private theme = -1;
  private width = 0;
  private height = 0;

  constructor(private readonly art: ArcadeArt) {
    this.screen.addChild(this.base);
    this.disc = new Sprite(art.disc);
    this.disc.anchor.set(0.5);
    this.disc.blendMode = "add";
    this.disc.alpha = 0.6;
    this.screen.addChild(this.disc);

    for (let i = 0; i < 4; i++) {
      const sprite = new Sprite(art.nebula);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.alpha = 0.34;
      this.nebulae.push(sprite);
      this.screen.addChild(sprite);
    }

    this.starLayers = art.stars.map((texture) => {
      const layer = new TilingSprite({ texture, width: 1, height: 1 });
      this.screen.addChild(layer);
      return layer;
    });

    this.terrain = new TilingSprite({
      texture: art.terrain[0],
      width: ARCADE_FIELD_W,
      height: ARCADE_FIELD_H,
    });
    this.field.addChild(this.terrain);
    this.field.addChild(this.edgeGlow);
  }

  setDetail(level: number): void {
    for (const sprite of this.nebulae) sprite.visible = level < 1;
    this.disc.visible = level < 2;
    const last = this.starLayers[this.starLayers.length - 1];
    if (last) last.visible = level < 2;
  }

  setTheme(index: number): void {
    const theme = Math.min(ARCADE_THEMES.length - 1, Math.max(0, index));
    if (theme === this.theme) return;
    this.theme = theme;
    const palette = ARCADE_THEMES[theme];
    this.terrain.texture = this.art.terrain[theme];
    this.disc.tint = palette.accent;
    for (const sprite of this.nebulae) sprite.tint = palette.nebula;
    this.redrawBase();
    this.edgeGlow.clear();
    for (let i = 0; i < 6; i++) {
      const a = 0.16 - i * 0.025;
      this.edgeGlow
        .rect(i * 4, 0, 4, ARCADE_FIELD_H)
        .fill({ color: palette.accent, alpha: a });
      this.edgeGlow
        .rect(ARCADE_FIELD_W - (i + 1) * 4, 0, 4, ARCADE_FIELD_H)
        .fill({ color: palette.accent, alpha: a });
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const layer of this.starLayers) {
      layer.width = width;
      layer.height = height;
    }
    this.redrawBase();
  }

  private redrawBase(): void {
    if (this.theme < 0) return;
    this.base.clear();
    this.base.rect(0, 0, this.width, this.height).fill({
      color: ARCADE_THEMES[this.theme].bg,
    });
  }

  update(scrollY: number, timeMs: number): void {
    const w = this.width;
    const h = this.height;
    this.terrain.tilePosition.y = scrollY % TERRAIN_TILE;
    const speeds = [0.12, 0.3, 0.55];
    this.starLayers.forEach((layer, i) => {
      layer.tilePosition.y = (scrollY * speeds[i]) % 512;
      layer.tilePosition.x = Math.sin(timeMs / 30000 + i) * 6;
    });
    const span = h + 900;
    this.nebulae.forEach((sprite, i) => {
      const phase = (scrollY * (0.18 + i * 0.05) + i * (span / 4)) % span;
      sprite.x = w * (0.2 + 0.2 * i + 0.05 * Math.sin(timeMs / 9000 + i));
      sprite.y = phase - 450;
      sprite.scale.set(2.2 + 0.4 * i);
      sprite.rotation = i * 1.3;
    });
    this.disc.x = w * 0.5;
    this.disc.y = h * 0.34 + Math.sin(timeMs / 14000) * 30;
    this.disc.rotation = timeMs / 60000;
    this.disc.scale.set(Math.max(w, h) / 760);
  }

  destroy(): void {
    this.screen.destroy({ children: true });
    this.field.destroy({ children: true });
  }
}
