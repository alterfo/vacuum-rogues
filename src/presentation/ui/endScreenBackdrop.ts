import { Container, Graphics } from "pixi.js";

export function mountEndScreenBackdrop(
  container: Container,
  width: number,
  height: number,
  accent: number,
): void {
  const bg = new Graphics();
  bg.rect(0, 0, width, height);
  bg.fill({ color: 0x000510, alpha: 1 });
  bg.eventMode = "static";

  const wash = new Graphics();
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    wash.rect(0, (height * i) / 6, width, height / 6).fill({
      color: accent,
      alpha: 0.05 * (1 - t),
    });
  }
  wash.eventMode = "none";

  const vignette = new Graphics();
  const bands = 12;
  for (let i = 0; i < bands; i++) {
    const inset = i * 14;
    vignette.rect(inset, inset, width - 2 * inset, height - 2 * inset).stroke({
      width: 28,
      color: 0x000000,
      alpha: 0.05 * (1 - i / bands),
    });
  }
  vignette.eventMode = "none";

  container.addChild(bg, wash, vignette);
}
