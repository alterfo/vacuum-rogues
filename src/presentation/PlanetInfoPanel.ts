import { Container, Graphics, Text } from "pixi.js";
import type { Planet } from "@/domain/Planet";

export class PlanetInfoPanel {
  public readonly container: Container;
  public readonly flightDays: number;
  private readonly planet: Planet;
  private readonly onLand?: () => void;

  constructor(
    planet: Planet,
    screenWidth: number,
    _screenHeight: number,
    flightDays: number,
    onLand?: () => void,
  ) {
    this.planet = planet;
    this.flightDays = flightDays;
    this.onLand = onLand;
    this.container = new Container();
    this.container.x = screenWidth - 240;
    this.container.y = 80;
    this.render();
  }

  render(): void {
    const bg = new Graphics();
    bg.rect(0, 0, 220, 200);
    bg.fill({ color: 0x000000, alpha: 0.8 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static";
    this.container.addChild(bg);

    const title = new Text({
      text: this.planet.name,
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: 0x00ffff,
        fontWeight: "bold",
      },
    });
    title.x = 10;
    title.y = 10;
    this.container.addChild(title);

    const type = new Text({
      text: `Тип: ${this.getType(this.planet.type)}`,
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0xaaaaaa },
    });
    type.x = 10;
    type.y = 35;
    this.container.addChild(type);

    const habitability = new Text({
      text: this.planet.isHabitable
        ? `Фракция: Окраинники`
        : `Дроны: ${this.planet.drones}`,
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0x88ccff },
    });
    habitability.x = 10;
    habitability.y = 55;
    this.container.addChild(habitability);

    const flight = new Text({
      text: `Перелёт: ${this.flightDays} дн.`,
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0xffaa00 },
    });
    flight.x = 10;
    flight.y = 80;
    this.container.addChild(flight);

    if (this.onLand) {
      const land = new Text({
        text: "[Приземлиться]",
        style: {
          fontFamily: "Courier New",
          fontSize: 12,
          fill: 0x00ff00,
          fontWeight: "bold",
        },
      });
      land.x = 10;
      land.y = 110;
      land.eventMode = "static";
      land.cursor = "pointer";
      land.on("pointerdown", (e) => {
        e.stopPropagation();
        this.onLand?.();
      });
      land.on("pointerover", () => {
        land.alpha = 0.7;
      });
      land.on("pointerout", () => {
        land.alpha = 1;
      });
      this.container.addChild(land);
    } else {
      const hint = new Text({
        text: "Подлетите ближе,\nчтобы приземлиться",
        style: { fontFamily: "Courier New", fontSize: 10, fill: 0x888888 },
      });
      hint.x = 10;
      hint.y = 110;
      hint.eventMode = "none";
      this.container.addChild(hint);
    }
  }

  private getType(type: string): string {
    const t: Record<string, string> = {
      TERRESTRIAL: "Земной",
      GAS_GIANT: "Газовый гигант",
      ICE: "Ледяной",
      VOLCANIC: "Вулканический",
      INDUSTRIAL: "Промышленный",
      HABITAT: "Обитаемый",
    };
    return t[type] ?? type;
  }

  destroy(): void {
    if (this.container.parent)
      this.container.parent.removeChild(this.container);
    this.container.destroy({ children: true });
  }
}
