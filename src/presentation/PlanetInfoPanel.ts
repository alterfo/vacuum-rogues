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
/** Vertical step between stacked info lines. */
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
  /**
   * Localized landing-denial reason (Overmind / pirate-rep) when the current
   * player may NOT land here, else undefined. When set, the «Приземлиться»
   * button is rendered inert (dimmed, no hover) and its click no-ops — the same
   * gate the scene's land-attempt applies, moved to the click surface so a
   * denied planet never even *attempts* the land (which would show a message and
   * burn a wait-turn day downstream). The wording comes from the shared
   * `landingDenialMessage`, so it matches the hover tooltip verbatim.
   */
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
    // Title can wrap to two lines; the info stack + land button follow it, and
    // the background rect is sized to the resulting content height.
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

    // Info line count is known up front, so the background can be sized and
    // mounted (behind everything) before the lines — avoids reordering the
    // scene graph after the fact.
    const infoLineCount = this.planet.isHabitable ? 7 : 3;
    // A denied land button carries an extra reason line below it — reserve room
    // so the background rect covers it instead of the text spilling past the box.
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
      // Unowned/unset systems are the project's "Независимая" (independent), not
      // "Окраинники" (the OUTLANDERS faction) — the former hardcoded fallback
      // silently mislabelled every ownerless planet as an Outlander world.
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
      addLine(
        `Отношение: ${getRepLabel(rep)}`,
        getRepColor(rep),
        /* rawColor */ true,
      );
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
        // Re-check the landing gate at click time: an un-landable planet's
        // button must no-op, never fall through to a doomed land attempt (which
        // shows a denial message and ends the turn — a wasted game day).
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
        // Say WHY landing is closed (Overmind / pirate rep) — same shared
        // wording as the hover tooltip, so the panel and tooltip never disagree.
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
    // Idempotent: closed via a deferred microtask (see PlanetManager.
    // closeInfoPanel) that may run after the scene's clearUILayer() already
    // destroyed this container — destroying it twice throws.
    if (this.container.destroyed) return;
    if (this.container.parent)
      this.container.parent.removeChild(this.container);
    this.container.destroy({ children: true });
  }
}
