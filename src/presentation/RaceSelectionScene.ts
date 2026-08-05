import { Container, Graphics, Text, Sprite } from "pixi.js";
import { GameScene } from "./GameScene";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FactionType, SceneType } from "@/types";
import type { GameMode } from "@/types";
import { logger } from "@/utils/logger";
import { pickVariant } from "./textures";
import { factionColor } from "./ui/palette";
import { FACTION_STATS } from "@/config/factionConfig";
import { t } from "@/i18n/i18n";

const GAME_MODE_OPTIONS: readonly GameMode[] = ["GOD", "NORMAL", "HARD"];

export class RaceSelectionScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private mainContainer: Container | null = null;
  private selectedFaction: FactionType = FactionType.OUTLANDERS;
  private selectedMode: GameMode = "NORMAL";
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "RACE_SELECTION",
    );
  }

  initialize(context?: { gameEngine: GameEngine }): void {
    if (!context?.gameEngine) {
      throw new Error("RaceSelectionScene requires gameEngine in context");
    }

    this.gameEngine = context.gameEngine;
    this.mainContainer = new Container();
    this.renderer.uiLayer.addChild(this.mainContainer);

    this.render();

    this.boundKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") void this.goBack();
    };
    window.addEventListener("keydown", this.boundKeyDown);

    this.mountHelp();

    logger.info("RaceSelectionScene initialized");
  }

  update(_deltaTime: number): void {
    // Static scene, no updates
  }

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    if (this.boundKeyDown) {
      window.removeEventListener("keydown", this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = null;
    }

    this.gameEngine = null;

    logger.info("RaceSelectionScene destroyed");
  }

  private async goBack(): Promise<void> {
    if (!this.gameEngine) return;
    await this.gameEngine.transitionTo(SceneType.MAIN_MENU, {
      gameEngine: this.gameEngine,
    });
  }

  private render(): void {
    if (!this.mainContainer) return;

    const screenWidth = this.renderer.app.screen.width;
    const screenHeight = this.renderer.app.screen.height;

    const background = new Graphics();
    background.rect(0, 0, screenWidth, screenHeight);
    background.fill({ color: 0x000510 });
    this.mainContainer.addChild(background);

    const title = new Text({
      text: t("race.title"),
      style: {
        fontFamily: "Courier New",
        fontSize: 28,
        fill: 0x00ffff,
        fontWeight: "bold",
        letterSpacing: 4,
      },
    });
    title.anchor.set(0.5);
    title.x = screenWidth / 2;
    title.y = 60;
    this.mainContainer.addChild(title);

    const factions = Object.values(FactionType);
    const cardWidth = 300;
    const cardHeight = 230;
    const gap = 20;
    const startX = (screenWidth - (cardWidth * 3 + gap * 2)) / 2;
    const startY = 130;

    for (let i = 0; i < factions.length; i++) {
      const faction = factions[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = startX + col * (cardWidth + gap);
      const y = startY + row * (cardHeight + gap);

      this.renderFactionCard(faction, x, y, cardWidth, cardHeight);
    }

    const modeSlot = factions.length;
    const modeRow = Math.floor(modeSlot / 3);
    const modeCol = modeSlot % 3;
    this.renderModeSelector(
      startX + modeCol * (cardWidth + gap),
      startY + modeRow * (cardHeight + gap),
      cardWidth,
      cardHeight,
    );

    const backBtn = new Text({
      text: t("race.back"),
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0x88ccff,
      },
    });
    backBtn.x = 20;
    backBtn.y = 20;
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    backBtn.on("pointerdown", (event) => {
      event.stopPropagation();
      void this.goBack();
    });
    backBtn.on("pointerover", () => {
      backBtn.alpha = 0.7;
    });
    backBtn.on("pointerout", () => {
      backBtn.alpha = 1;
    });
    this.mainContainer.addChild(backBtn);

    this.renderStartButton(screenWidth / 2, screenHeight - 80);
  }

  private renderModeSelector(
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.mainContainer) return;

    const panel = new Container();
    panel.x = x;
    panel.y = y;

    const bg = new Graphics();
    bg.rect(0, 0, width, height);
    bg.fill({ color: 0x0a1a2a, alpha: 0.6 });
    bg.stroke({ color: 0x335577, width: 1 });
    bg.eventMode = "none";
    panel.addChild(bg);

    const header = new Text({
      text: t("race.difficulty"),
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0x88ccff,
        fontWeight: "bold",
        letterSpacing: 3,
      },
    });
    header.anchor.set(0.5, 0);
    header.x = width / 2;
    header.y = 10;
    header.eventMode = "none";
    panel.addChild(header);

    this.mainContainer.addChild(panel);

    const inset = 10;
    const headerH = 38;
    const chipGap = 10;
    const count = GAME_MODE_OPTIONS.length;
    const chipW = width - inset * 2;
    const chipH = (height - headerH - inset - chipGap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const cy = y + headerH + i * (chipH + chipGap);
      this.renderModeChip(GAME_MODE_OPTIONS[i], x + inset, cy, chipW, chipH);
    }
  }

  private renderModeChip(
    mode: GameMode,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.mainContainer) return;

    const chip = new Container();
    chip.x = x;
    chip.y = y;

    const isSelected = mode === this.selectedMode;
    const bg = new Graphics();
    bg.rect(0, 0, width, height);
    bg.fill({ color: isSelected ? 0x1a3a4a : 0x0a1a2a, alpha: 0.95 });
    bg.stroke({
      color: isSelected ? 0x00ffff : 0x444444,
      width: isSelected ? 3 : 2,
    });
    bg.eventMode = "static";
    bg.cursor = "pointer";
    chip.addChild(bg);

    const title = new Text({
      text: t(`race.mode.${mode}.title`),
      style: {
        fontFamily: "Courier New",
        fontSize: 14,
        fill: isSelected ? 0x00ffff : 0xffffff,
        fontWeight: "bold",
      },
    });
    title.x = 10;
    title.y = 6;
    title.eventMode = "none";
    chip.addChild(title);

    const desc = new Text({
      text: t(`race.mode.${mode}.desc`),
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0xbbbbbb,
        wordWrap: true,
        wordWrapWidth: width - 20,
        lineHeight: 12,
      },
    });
    desc.x = 10;
    desc.y = 24;
    desc.eventMode = "none";
    chip.addChild(desc);

    bg.on("pointerdown", () => {
      this.selectMode(mode);
    });

    bg.on("pointerover", () => {
      if (!isSelected) {
        bg.clear();
        bg.rect(0, 0, width, height);
        bg.fill({ color: 0x152535, alpha: 0.98 });
        bg.stroke({ color: 0x00ffff, width: 2 });
      }
    });

    bg.on("pointerout", () => {
      if (!isSelected) {
        bg.clear();
        bg.rect(0, 0, width, height);
        bg.fill({ color: 0x0a1a2a, alpha: 0.95 });
        bg.stroke({ color: 0x444444, width: 2 });
      }
    });

    this.mainContainer.addChild(chip);
  }

  private selectMode(mode: GameMode): void {
    this.selectedMode = mode;
    logger.info(`Selected game mode: ${mode}`);
    this.refresh();
  }

  private renderFactionCard(
    faction: FactionType,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.mainContainer) return;

    const cardContainer = new Container();
    cardContainer.x = x;
    cardContainer.y = y;

    const isSelected = faction === this.selectedFaction;
    const cardBg = new Graphics();
    cardBg.rect(0, 0, width, height);
    cardBg.fill({ color: isSelected ? 0x1a3a4a : 0x0a1a2a, alpha: 0.95 });
    cardBg.stroke({
      color: isSelected ? factionColor(faction) : 0x444444,
      width: isSelected ? 3 : 2,
    });
    cardBg.eventMode = "static";
    cardBg.cursor = "pointer";
    cardContainer.addChild(cardBg);

    const portraitW = 104;
    const portraitX = 8;
    const portraitY = 34;
    const portraitH = height - portraitY - 8;
    this.renderPortrait(
      cardContainer,
      faction,
      portraitX,
      portraitY,
      portraitW,
      portraitH,
    );

    const textX = portraitX + portraitW + 10;
    const textW = width - textX - 10;

    const factionName = new Text({
      text: t(`race.faction.${faction}.title`),
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: isSelected ? factionColor(faction) : 0xffffff,
        fontWeight: "bold",
      },
    });
    factionName.x = 10;
    factionName.y = 10;
    factionName.eventMode = "none";
    cardContainer.addChild(factionName);

    const description = t(`race.faction.${faction}.desc`);
    const descText = new Text({
      text: description,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xcccccc,
        wordWrap: true,
        wordWrapWidth: textW,
        lineHeight: 14,
      },
    });
    descText.x = textX;
    descText.y = 34;
    descText.eventMode = "none";
    cardContainer.addChild(descText);

    const bonusText = new Text({
      text: t(`race.faction.${faction}.bonus`),
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: 0xffaa00,
        wordWrap: true,
        wordWrapWidth: textW,
      },
    });
    bonusText.x = textX;
    bonusText.y = 120;
    bonusText.eventMode = "none";
    cardContainer.addChild(bonusText);

    const stats = this.getFactionStatsText(faction);
    const statsText = new Text({
      text: stats,
      style: {
        fontFamily: "Courier New",
        fontSize: 10,
        fill: 0xaaaaaa,
        lineHeight: 14,
      },
    });
    statsText.x = textX;
    statsText.y = 168;
    statsText.eventMode = "none";
    cardContainer.addChild(statsText);

    cardBg.on("pointerdown", () => {
      this.selectFaction(faction);
    });

    cardBg.on("pointerover", () => {
      if (faction !== this.selectedFaction) {
        cardBg.clear();
        cardBg.rect(0, 0, width, height);
        cardBg.fill({ color: 0x152535, alpha: 0.98 });
        cardBg.stroke({ color: factionColor(faction), width: 2 });
      }
    });

    cardBg.on("pointerout", () => {
      if (faction !== this.selectedFaction) {
        cardBg.clear();
        cardBg.rect(0, 0, width, height);
        cardBg.fill({ color: 0x0a1a2a, alpha: 0.95 });
        cardBg.stroke({ color: 0x444444, width: 2 });
      }
    });

    this.mainContainer.addChild(cardContainer);
  }

  private renderPortrait(
    container: Container,
    faction: FactionType,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const color = factionColor(faction);

    const plate = new Graphics();
    plate.rect(x, y, w, h);
    plate.fill({ color: 0x05111c });
    plate.eventMode = "none";
    container.addChild(plate);

    const texture = pickVariant("portraits", faction.toLowerCase(), faction);
    if (texture) {
      const sprite = new Sprite(texture);
      const scale = Math.max(w / texture.width, h / texture.height);
      sprite.scale.set(scale);
      sprite.anchor.set(0.5, 0);
      sprite.x = x + w / 2;
      sprite.y = y;
      sprite.eventMode = "none";

      const mask = new Graphics();
      mask.rect(x, y, w, h);
      mask.fill({ color: 0xffffff });
      mask.eventMode = "none";
      sprite.mask = mask;
      container.addChild(mask);
      container.addChild(sprite);
    }

    const frame = new Graphics();
    frame.rect(x, y, w, h);
    frame.stroke({ color, width: 1, alpha: 0.8 });
    frame.eventMode = "none";
    container.addChild(frame);
  }

  private getFactionStatsText(faction: FactionType): string {
    const stats = FACTION_STATS[faction];
    const lines = [
      t("race.stat.hull", { value: stats.hull }),
      t("race.stat.shields", { value: stats.shields }),
      t("race.stat.speed", { value: stats.speed.toFixed(1) }),
      t("race.stat.evasion", { value: stats.evasion.toFixed(1) }),
    ];
    return lines.join("\n");
  }

  private selectFaction(factionType: FactionType): void {
    this.selectedFaction = factionType;
    logger.info(`Selected faction: ${factionType}`);

    this.refresh();
  }

  private renderStartButton(x: number, y: number): void {
    if (!this.mainContainer) return;

    const buttonContainer = new Container();
    buttonContainer.x = x;
    buttonContainer.y = y;

    const buttonWidth = 300;
    const buttonHeight = 50;

    const btnBg = new Graphics();
    btnBg.rect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight);
    btnBg.fill({ color: 0x004488, alpha: 0.9 });
    btnBg.stroke({ color: 0x00ffff, width: 2 });
    buttonContainer.addChild(btnBg);

    const btnText = new Text({
      text: t("race.start"),
      style: {
        fontFamily: "Courier New",
        fontSize: 20,
        fill: 0xffffff,
        fontWeight: "bold",
      },
    });
    btnText.anchor.set(0.5);
    btnText.y = 0;
    buttonContainer.addChild(btnText);

    buttonContainer.eventMode = "static";
    buttonContainer.cursor = "pointer";
    buttonContainer.on("pointerdown", () => {
      this.startGame();
    });

    buttonContainer.on("pointerover", () => {
      btnBg.clear();
      btnBg.rect(
        -buttonWidth / 2,
        -buttonHeight / 2,
        buttonWidth,
        buttonHeight,
      );
      btnBg.fill({ color: 0x0066aa, alpha: 1.0 });
      btnBg.stroke({ color: 0x00ffff, width: 3 });
    });

    buttonContainer.on("pointerout", () => {
      btnBg.clear();
      btnBg.rect(
        -buttonWidth / 2,
        -buttonHeight / 2,
        buttonWidth,
        buttonHeight,
      );
      btnBg.fill({ color: 0x004488, alpha: 0.9 });
      btnBg.stroke({ color: 0x00ffff, width: 2 });
    });

    this.mainContainer.addChild(buttonContainer);
  }

  private async startGame(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info(
      `Starting game with faction: ${this.selectedFaction}, mode: ${this.selectedMode}`,
    );

    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      selectedFaction: this.selectedFaction,
      selectedGameMode: this.selectedMode,
    });
  }

  e2eSelectFaction(faction: string): void {
    if (!__DEBUG__) return;
    const upper = faction.toUpperCase() as FactionType;
    const valid = (Object.values(FactionType) as string[]).includes(upper);
    this.selectFaction(valid ? upper : FactionType.OUTLANDERS);
  }

  e2eSelectMode(mode: string): void {
    if (!__DEBUG__) return;
    const upper = mode.toUpperCase() as GameMode;
    const valid = GAME_MODE_OPTIONS.includes(upper);
    this.selectMode(valid ? upper : "NORMAL");
  }

  e2eConfirmSelection(): void {
    if (!__DEBUG__) return;
    void this.startGame();
  }

  private refresh(): void {
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = new Container();
      this.renderer.uiLayer.addChild(this.mainContainer);
      this.render();
    }
  }
}
