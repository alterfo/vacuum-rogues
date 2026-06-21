import { Container, Graphics, Text, Sprite } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { FactionType, SceneType } from "@/types";
import type { GameMode } from "@/types";
import { logger } from "@/utils/logger";
import { pickVariant } from "./textures";
import {
  FACTION_TITLES,
  FACTION_DESCRIPTIONS,
  FACTION_COLORS,
  FACTION_STATS,
  FACTION_BONUSES,
} from "@/config/factionConfig";

/**
 * Difficulty modes offered on the new-game screen. Default is Средний (NORMAL),
 * reproducing today's behaviour; God floors hull + downs the ship until repair;
 * Hard adds hostiles. The chosen mode is passed into new-game player creation.
 */
const GAME_MODE_OPTIONS: { mode: GameMode; title: string; desc: string }[] = [
  {
    mode: "GOD",
    title: "Бог",
    desc: "Корабль не гибнет — при нуле прочности глохнут оружие и гиперпрыжок до ремонта",
  },
  {
    mode: "NORMAL",
    title: "Средний",
    desc: "Стандартная сложность",
  },
  {
    mode: "HARD",
    title: "Сложный",
    desc: "Больше пиратов и Сверхразума, крупнее гарнизоны",
  },
];

/**
 * Faction Selection Scene - allows player to choose their faction before starting the game
 */
export class RaceSelectionScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private mainContainer: Container | null = null;
  private selectedFaction: FactionType = FactionType.OUTLANDERS;
  private selectedMode: GameMode = "NORMAL";
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
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

    logger.info("RaceSelectionScene initialized");
  }

  update(_deltaTime: number): void {
    // Static scene, no updates
  }

  destroy(): void {
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

  /**
   * Render the faction selection UI
   */
  private render(): void {
    if (!this.mainContainer) return;

    const screenWidth = this.renderer.app.screen.width;
    const screenHeight = this.renderer.app.screen.height;

    // Background
    const background = new Graphics();
    background.rect(0, 0, screenWidth, screenHeight);
    background.fill({ color: 0x000510 });
    this.mainContainer.addChild(background);

    // Title
    const title = new Text({
      text: "ВЫБЕРИТЕ ФРАКЦИЮ",
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

    // Render faction cards in a grid
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

    // The difficulty selector fills the next grid cell after the last faction
    // card (with 5 factions that's the empty bottom-right slot — no overlap with
    // the cards or the Start button).
    const modeSlot = factions.length;
    const modeRow = Math.floor(modeSlot / 3);
    const modeCol = modeSlot % 3;
    this.renderModeSelector(
      startX + modeCol * (cardWidth + gap),
      startY + modeRow * (cardHeight + gap),
      cardWidth,
      cardHeight,
    );

    // Back button (top-left)
    const backBtn = new Text({
      text: "[ Назад ]",
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

    // Start button
    this.renderStartButton(screenWidth / 2, screenHeight - 80);
  }

  /**
   * Render the difficulty-mode selector (Бог / Средний / Сложный) inside a
   * card-sized box. The chosen mode is carried into new-game player creation by
   * {@link startGame}.
   */
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

    // Faint backing panel so the box reads as part of the grid.
    const bg = new Graphics();
    bg.rect(0, 0, width, height);
    bg.fill({ color: 0x0a1a2a, alpha: 0.6 });
    bg.stroke({ color: 0x335577, width: 1 });
    bg.eventMode = "none";
    panel.addChild(bg);

    // Header
    const header = new Text({
      text: "СЛОЖНОСТЬ",
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

    // Three full-width chips stacked vertically below the header.
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

  /**
   * Render a single difficulty chip; the currently-selected mode is highlighted.
   */
  private renderModeChip(
    opt: { mode: GameMode; title: string; desc: string },
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (!this.mainContainer) return;

    const chip = new Container();
    chip.x = x;
    chip.y = y;

    const isSelected = opt.mode === this.selectedMode;
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
      text: opt.title,
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
      text: opt.desc,
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
      this.selectMode(opt.mode);
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

  /** Select a difficulty mode and re-render to reflect the choice. */
  private selectMode(mode: GameMode): void {
    this.selectedMode = mode;
    logger.info(`Selected game mode: ${mode}`);
    this.refresh();
  }

  /**
   * Render a single faction card
   */
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

    // Card background
    const isSelected = faction === this.selectedFaction;
    const cardBg = new Graphics();
    cardBg.rect(0, 0, width, height);
    cardBg.fill({ color: isSelected ? 0x1a3a4a : 0x0a1a2a, alpha: 0.95 });
    cardBg.stroke({
      color: isSelected ? FACTION_COLORS[faction] : 0x444444,
      width: isSelected ? 3 : 2,
    });
    cardBg.eventMode = "static";
    cardBg.cursor = "pointer";
    cardContainer.addChild(cardBg);

    // Faction portrait (left column). Clicks pass through to the card below.
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

    // Text column sits to the right of the portrait.
    const textX = portraitX + portraitW + 10;
    const textW = width - textX - 10;

    // Faction name
    const factionName = new Text({
      text: FACTION_TITLES[faction],
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: isSelected ? FACTION_COLORS[faction] : 0xffffff,
        fontWeight: "bold",
      },
    });
    factionName.x = 10;
    factionName.y = 10;
    factionName.eventMode = "none";
    cardContainer.addChild(factionName);

    // Faction description
    const description = FACTION_DESCRIPTIONS[faction];
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

    // Unique bonus
    const bonusText = new Text({
      text: FACTION_BONUSES[faction],
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

    // Stats
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

    // Click handler
    cardBg.on("pointerdown", () => {
      this.selectFaction(faction);
    });

    // Hover effect
    cardBg.on("pointerover", () => {
      if (faction !== this.selectedFaction) {
        cardBg.clear();
        cardBg.rect(0, 0, width, height);
        cardBg.fill({ color: 0x152535, alpha: 0.98 });
        cardBg.stroke({ color: FACTION_COLORS[faction], width: 2 });
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

  /**
   * Render the faction's character portrait into a framed box on the card.
   * Cover-fits the art (top-anchored so the face shows) and crops to the box
   * with a mask. Falls back to a tinted silhouette plate when art is missing
   * (e.g. in unit tests where textures aren't preloaded).
   */
  private renderPortrait(
    container: Container,
    faction: FactionType,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const color = FACTION_COLORS[faction];

    // Backing plate (also shows through if the art has transparency).
    const plate = new Graphics();
    plate.rect(x, y, w, h);
    plate.fill({ color: 0x05111c });
    plate.eventMode = "none";
    container.addChild(plate);

    const texture = pickVariant("portraits", faction.toLowerCase(), faction);
    if (texture) {
      const sprite = new Sprite(texture);
      // Cover-fit: fill the box, anchored to the top so the head/face stays in
      // view while the lower body is cropped off the bottom.
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

    // Frame around the portrait.
    const frame = new Graphics();
    frame.rect(x, y, w, h);
    frame.stroke({ color, width: 1, alpha: 0.8 });
    frame.eventMode = "none";
    container.addChild(frame);
  }

  /**
   * Get formatted stats text for faction
   */
  private getFactionStatsText(faction: FactionType): string {
    const stats = FACTION_STATS[faction];
    const lines = [
      `Корпус: ${stats.hull}`,
      `Щиты: ${stats.shields}`,
      `Скорость: ${stats.speed.toFixed(1)}`,
      `Уворот: ${stats.evasion.toFixed(1)}`,
    ];
    return lines.join("\n");
  }

  /**
   * Select a faction
   */
  private selectFaction(factionType: FactionType): void {
    this.selectedFaction = factionType;
    logger.info(`Selected faction: ${factionType}`);

    // Re-render to update selection
    this.refresh();
  }

  /**
   * Render start game button
   */
  private renderStartButton(x: number, y: number): void {
    if (!this.mainContainer) return;

    const buttonContainer = new Container();
    buttonContainer.x = x;
    buttonContainer.y = y;

    const buttonWidth = 300;
    const buttonHeight = 50;

    // Button background
    const btnBg = new Graphics();
    btnBg.rect(-buttonWidth / 2, -buttonHeight / 2, buttonWidth, buttonHeight);
    btnBg.fill({ color: 0x004488, alpha: 0.9 });
    btnBg.stroke({ color: 0x00ffff, width: 2 });
    buttonContainer.addChild(btnBg);

    // Button text
    const btnText = new Text({
      text: "НАЧАТЬ ИГРУ",
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

    // Make button interactive
    buttonContainer.eventMode = "static";
    buttonContainer.cursor = "pointer";
    buttonContainer.on("pointerdown", () => {
      this.startGame();
    });

    // Hover effects
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

  /**
   * Start the game with selected faction
   */
  private async startGame(): Promise<void> {
    if (!this.gameEngine) return;

    logger.info(
      `Starting game with faction: ${this.selectedFaction}, mode: ${this.selectedMode}`,
    );

    // Pass selected faction + difficulty mode to GameEngine for player creation
    await this.gameEngine.transitionTo(SceneType.SPACE_FLIGHT, {
      gameEngine: this.gameEngine,
      selectedFaction: this.selectedFaction,
      selectedGameMode: this.selectedMode,
    });
  }

  /**
   * E2E hook: select a faction by name string.
   * Accepts a FactionType value (case-insensitive); defaults to OUTLANDERS.
   */
  e2eSelectFaction(faction: string): void {
    if (!__DEBUG__) return;
    const upper = faction.toUpperCase() as FactionType;
    const valid = (Object.values(FactionType) as string[]).includes(upper);
    this.selectFaction(valid ? upper : FactionType.OUTLANDERS);
  }

  /**
   * E2E hook: select a difficulty mode by name string.
   * Accepts a GameMode value (case-insensitive); defaults to NORMAL.
   */
  e2eSelectMode(mode: string): void {
    if (!__DEBUG__) return;
    const upper = mode.toUpperCase();
    const valid = GAME_MODE_OPTIONS.some((o) => o.mode === upper);
    this.selectMode(valid ? (upper as GameMode) : "NORMAL");
  }

  /**
   * E2E hook: trigger the "НАЧАТЬ ИГРУ" button programmatically.
   */
  e2eConfirmSelection(): void {
    if (!__DEBUG__) return;
    void this.startGame();
  }

  /**
   * Refresh the UI
   */
  private refresh(): void {
    if (this.mainContainer) {
      this.mainContainer.destroy({ children: true });
      this.mainContainer = new Container();
      this.renderer.uiLayer.addChild(this.mainContainer);
      this.render();
    }
  }
}
