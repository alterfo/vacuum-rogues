import { Container, Graphics } from "pixi.js";
import type { Planet } from "@/domain/Planet";
import { Faction } from "@/types/faction";
import { factionDisplayLabel } from "@/config/factionConfig";
import { scaledText } from "./ui/scaledText";
import { getRepLabel, getRepColor } from "@/utils/reputationUtils";
import {
  economyLabel,
  politicalLabel,
  resolvePopulation,
  formatPopulation,
} from "./ui/planetProfile";

const PANEL_WIDTH = 220;
const LINE_STEP = 20;

export class PlanetInfoPanel {
  public readonly container: Container;
  public readonly flightDays: number;
  private readonly planet: Planet;
  private readonly onLand?: () => void;
  private readonly ownerFaction?: string;
  private readonly economyType?: string;
  private readonly politicalSystem?: string;
  private readonly reputation?: number;
  private readonly landingDenialText?: string;

  constructor(
    planet: Planet,
    screenWidth: number,
    _screenHeight: number,
    flightDays: number,
    onLand?: () => void,
    ownerFaction?: string,
    economyType?: string,
    politicalSystem?: string,
    reputation?: number,
    landingDenialText?: string,
  ) {
    this.planet = planet;
    this.flightDays = flightDays;
    this.onLand = onLand;
    this.ownerFaction = ownerFaction;
    this.economyType = economyType;
    this.politicalSystem = politicalSystem;
    this.reputation = reputation;
    this.landingDenialText = landingDenialText;
    this.container = new Container();
    this.container.x = screenWidth - 240;
    this.container.y = 80;
    this.render();
  }

  render(): void {
    const title = scaledText(this.planet.name, 14, 0x00ffff, {
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: PANEL_WIDTH - 20,
      breakWords: true,
    });
    title.x = 10;
    title.y = 10;

    const titleHeight = Number.isFinite(title.height)
      ? title.height
      : LINE_STEP;
    const contentTop = title.y + Math.max(LINE_STEP + 5, titleHeight + 6);

    const infoLineCount = this.planet.isHabitable ? 7 : 3;
    const denialLine = this.onLand && this.landingDenialText ? 1 : 0;
    const panelHeight =
      contentTop +
      infoLineCount * LINE_STEP +
      LINE_STEP +
      denialLine * LINE_STEP +
      12;

    const bg = new Graphics();
    bg.rect(0, 0, PANEL_WIDTH, panelHeight);
    bg.fill({ color: 0x000000, alpha: 0.8 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static";
    this.container.addChild(bg);
    this.container.addChild(title);

    let y = contentTop;
    const addLine = (text: string, color: number, rawColor = false): void => {
      const line = scaledText(text, 11, color, { rawColor });
      line.x = 10;
      line.y = y;
      line.eventMode = "none";
      this.container.addChild(line);
      y += LINE_STEP;
    };

    addLine(`Тип: ${this.getType(this.planet.type)}`, 0xaaaaaa);

    if (this.planet.isHabitable) {
      const factionName = factionDisplayLabel(
        this.ownerFaction ?? Faction.INDEPENDENT,
      );
      addLine(`Фракция: ${factionName}`, 0x88ccff);

      const pop = resolvePopulation(
        this.planet.population,
        this.planet.id ?? this.planet.name ?? "",
      );
      addLine(`Население: ${formatPopulation(pop)}`, 0x88ccff);
      addLine(`Экономика: ${economyLabel(this.economyType)}`, 0x88ccff);
      addLine(`Строй: ${politicalLabel(this.politicalSystem)}`, 0x88ccff);

      const rep = this.reputation ?? 0;
      addLine(`Отношение: ${getRepLabel(rep)}`, getRepColor(rep), true);
    } else {
      addLine(`Дроны: ${this.planet.drones}`, 0x88ccff);
    }

    addLine(`Перелёт: ${this.flightDays} дн.`, 0xffaa00);

    if (this.onLand) {
      const denied =
        this.landingDenialText != null && this.landingDenialText !== "";
      const land = scaledText(
        "[Приземлиться]",
        12,
        denied ? 0x888888 : 0x00ff00,
        {
          fontWeight: "bold",
          rawColor: true,
        },
      );
      land.x = 10;
      land.y = y + 4;
      land.eventMode = "static";
      land.cursor = denied ? "default" : "pointer";
      land.on("pointerdown", (e) => {
        e.stopPropagation();
        if (this.landingDenialText != null && this.landingDenialText !== "")
          return;
        this.onLand?.();
      });
      land.on("pointerover", () => {
        if (!denied) land.alpha = 0.7;
      });
      land.on("pointerout", () => {
        land.alpha = 1;
      });
      this.container.addChild(land);
      y = land.y + LINE_STEP;
      if (denied) {
        const reason = scaledText(this.landingDenialText, 10, 0xff6666, {
          rawColor: true,
        });
        reason.x = 10;
        reason.y = y;
        reason.eventMode = "none";
        this.container.addChild(reason);
        y += LINE_STEP;
      }
    } else {
      const hint = scaledText(
        "Подлетите ближе,\nчтобы приземлиться",
        10,
        0xb4b4b4,
      );
      hint.x = 10;
      hint.y = y + 4;
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
    if (this.container.destroyed) return;
    if (this.container.parent)
      this.container.parent.removeChild(this.container);
    this.container.destroy({ children: true });
  }
}
