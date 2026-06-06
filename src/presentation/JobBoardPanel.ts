import { Container, Graphics, Text } from "pixi.js";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import { QuestType } from "@/types";

export interface JobBoardCallbacks {
  onAccept: (quest: GeneratedQuest) => void;
  onClose: () => void;
}

const TYPE_LABEL: Record<QuestType, string> = {
  [QuestType.DELIVERY]: "Доставка",
  [QuestType.BOUNTY]: "Охота",
  [QuestType.ESCORT]: "Эскорт",
  [QuestType.DIPLOMACY]: "Дипломатия",
  [QuestType.EXPLORATION]: "Разведка",
  [QuestType.TEXT_ADVENTURE]: "✦ История",
};

const TYPE_COLOR: Record<QuestType, number> = {
  [QuestType.DELIVERY]: 0x88ccff,
  [QuestType.BOUNTY]: 0xff6666,
  [QuestType.ESCORT]: 0x88ff88,
  [QuestType.DIPLOMACY]: 0xffcc66,
  [QuestType.EXPLORATION]: 0x66ddff,
  [QuestType.TEXT_ADVENTURE]: 0xff99ff,
};

/** Maximum number of quests a player can hold simultaneously. */
export const MAX_ACTIVE_QUESTS = 3;

/**
 * Planet job board (EPIC-008 US-080): lists the quests a planet currently
 * offers. Each row has an explicit "Принять" button. The button is disabled
 * when the player already has MAX_ACTIVE_QUESTS active quests or has already
 * accepted this quest. Follows the CLAUDE.md PixiJS rules (stopPropagation on
 * interactive elements, text eventMode='none' over clickable areas).
 */
export class JobBoardPanel {
  public readonly container: Container;
  private readonly callbacks: JobBoardCallbacks;

  private static readonly W = 480;
  private static readonly ROW_H = 60;
  private static readonly HEAD = 48;

  constructor(
    quests: GeneratedQuest[],
    screenWidth: number,
    screenHeight: number,
    callbacks: JobBoardCallbacks,
    /** How many active quests the player currently holds. */
    activeQuestCount = 0,
    /** IDs of quests already accepted (so their Принять button is grayed). */
    acceptedQuestIds: ReadonlySet<string> = new Set(),
  ) {
    this.callbacks = callbacks;
    this.container = new Container();
    const rows = Math.max(quests.length, 1);
    const h = JobBoardPanel.HEAD + rows * JobBoardPanel.ROW_H + 16;
    this.container.x = Math.round((screenWidth - JobBoardPanel.W) / 2);
    this.container.y = Math.round((screenHeight - h) / 2);
    this.render(quests, h, activeQuestCount, acceptedQuestIds);
  }

  private render(
    quests: GeneratedQuest[],
    h: number,
    activeQuestCount: number,
    acceptedQuestIds: ReadonlySet<string>,
  ): void {
    const W = JobBoardPanel.W;
    const bg = new Graphics();
    bg.rect(0, 0, W, h).fill({ color: 0x05101c, alpha: 0.96 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static";
    this.container.addChild(bg);

    this.label("ДОСКА ЗАДАНИЙ", 16, 14, 18, 0x00ffff, true);
    this.addCloseX(W);

    const atLimit = activeQuestCount >= MAX_ACTIVE_QUESTS;
    if (atLimit) {
      this.label(
        `Максимум заданий: ${MAX_ACTIVE_QUESTS}/${MAX_ACTIVE_QUESTS}`,
        16,
        JobBoardPanel.HEAD - 16,
        11,
        0xff8844,
      );
    }

    if (quests.length === 0) {
      this.label(
        "Свободных заданий нет.",
        16,
        JobBoardPanel.HEAD + 8,
        14,
        0xffaa00,
      );
      return;
    }

    let y = JobBoardPanel.HEAD;
    for (const q of quests) {
      const alreadyTaken = acceptedQuestIds.has(q.template.id);
      const canAccept = !atLimit && !alreadyTaken;
      this.addRow(q, y, W, canAccept, alreadyTaken);
      y += JobBoardPanel.ROW_H;
    }
  }

  private addRow(
    q: GeneratedQuest,
    y: number,
    W: number,
    canAccept: boolean,
    alreadyTaken: boolean,
  ): void {
    const rowH = JobBoardPanel.ROW_H - 6;
    const t = q.template;
    const color = TYPE_COLOR[t.type] ?? 0xffffff;

    const row = new Graphics();
    row.roundRect(10, y, W - 20, rowH, 5).fill({ color: 0x0e2236, alpha: 0.9 });
    row.stroke({ color, width: 1, alpha: 0.7 });
    row.eventMode = "static";
    this.container.addChild(row);

    // Type tag
    const tag = TYPE_LABEL[t.type] ?? t.type;
    this.label(tag, 20, y + 6, 11, color);

    // Title (truncated)
    const title = t.title.length > 32 ? t.title.slice(0, 31) + "…" : t.title;
    this.label(title, 20, y + 22, 12, 0xffffff, true);

    // Reward / deadline / jumps on the right side of info area
    const deadlineDays = t.deadline > 0 ? `  ⏱ ${t.deadline}д` : "";
    const jumpsText = q.jumps > 0 ? `  ⤴ ${q.jumps}` : "";
    const meta = `💰 ${t.reward.credits}${deadlineDays}${jumpsText}`;
    const m = new Text({
      text: meta,
      style: { fontFamily: "Courier New", fontSize: 11, fill: 0xffe27a },
    });
    m.eventMode = "none";
    m.anchor.set(1, 0);
    m.x = W - 90;
    m.y = y + 22;
    this.container.addChild(m);

    // "Принять" button on the right
    const btnW = 74;
    const btnH = rowH - 8;
    const btnX = W - 86;
    const btnY = y + 4;

    const btnBg = new Graphics();
    if (alreadyTaken) {
      btnBg
        .roundRect(btnX, btnY, btnW, btnH, 4)
        .fill({ color: 0x113322, alpha: 0.9 });
      btnBg.stroke({ color: 0x226644, width: 1 });
    } else if (canAccept) {
      btnBg
        .roundRect(btnX, btnY, btnW, btnH, 4)
        .fill({ color: 0x004433, alpha: 0.9 });
      btnBg.stroke({ color: 0x00cc88, width: 1 });
      btnBg.eventMode = "static";
      btnBg.cursor = "pointer";
      btnBg.on("pointerdown", (e) => {
        e.stopPropagation();
        this.callbacks.onAccept(q);
      });
      btnBg.on("pointerover", () => {
        btnBg.clear();
        btnBg
          .roundRect(btnX, btnY, btnW, btnH, 4)
          .fill({ color: 0x006655, alpha: 1.0 });
        btnBg.stroke({ color: 0x00ffaa, width: 1 });
      });
      btnBg.on("pointerout", () => {
        btnBg.clear();
        btnBg
          .roundRect(btnX, btnY, btnW, btnH, 4)
          .fill({ color: 0x004433, alpha: 0.9 });
        btnBg.stroke({ color: 0x00cc88, width: 1 });
      });
    } else {
      btnBg
        .roundRect(btnX, btnY, btnW, btnH, 4)
        .fill({ color: 0x111111, alpha: 0.8 });
      btnBg.stroke({ color: 0x333333, width: 1 });
    }
    this.container.addChild(btnBg);

    const btnLabel = alreadyTaken
      ? "✓ Принято"
      : canAccept
        ? "Принять"
        : "Занят";
    const btnLbl = new Text({
      text: btnLabel,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: alreadyTaken ? 0x44aa66 : canAccept ? 0x00ffaa : 0x555555,
        fontWeight: "bold",
      },
    });
    btnLbl.eventMode = "none";
    btnLbl.anchor.set(0.5);
    btnLbl.x = btnX + btnW / 2;
    btnLbl.y = btnY + btnH / 2;
    this.container.addChild(btnLbl);
  }

  private addCloseX(W: number): void {
    const bg = new Graphics();
    bg.roundRect(W - 30, 10, 22, 22, 4).fill({ color: 0x000000, alpha: 0.85 });
    bg.stroke({ color: 0xff6666, width: 1 });
    bg.eventMode = "static";
    bg.cursor = "pointer";
    bg.on("pointerdown", (e) => {
      e.stopPropagation();
      this.callbacks.onClose();
    });
    this.container.addChild(bg);

    const x = new Text({
      text: "✕",
      style: {
        fontFamily: "Courier New",
        fontSize: 16,
        fill: 0xff6666,
        fontWeight: "bold",
      },
    });
    x.eventMode = "none";
    x.x = W - 24;
    x.y = 12;
    this.container.addChild(x);
  }

  private label(
    text: string,
    x: number,
    y: number,
    size: number,
    color: number,
    bold = false,
  ): void {
    const t = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: size,
        fill: color,
        fontWeight: bold ? "bold" : "normal",
      },
    });
    t.x = x;
    t.y = y;
    t.eventMode = "none";
    this.container.addChild(t);
  }

  destroy(): void {
    if (!this.container.destroyed) this.container.destroy({ children: true });
  }
}
