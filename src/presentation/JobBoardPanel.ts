import { Container, Graphics, Text } from "pixi.js";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { Quest } from "@/domain/Quest";
import { QuestType } from "@/types";

export interface JobBoardCallbacks {
  onAccept: (quest: GeneratedQuest) => void;
  onClose: () => void;
}

export const TYPE_LABEL: Record<QuestType, string> = {
  [QuestType.DELIVERY]: "Доставка",
  [QuestType.BOUNTY]: "Охота",
  [QuestType.ESCORT]: "Эскорт",
  [QuestType.DIPLOMACY]: "Дипломатия",
  [QuestType.EXPLORATION]: "Разведка",
  [QuestType.TEXT_ADVENTURE]: "✦ История",
  [QuestType.DEFENSE]: "⚔ Оборона",
};

const TYPE_COLOR: Record<QuestType, number> = {
  [QuestType.DELIVERY]: 0x88ccff,
  [QuestType.BOUNTY]: 0xff6666,
  [QuestType.ESCORT]: 0x88ff88,
  [QuestType.DIPLOMACY]: 0xffcc66,
  [QuestType.EXPLORATION]: 0x66ddff,
  [QuestType.TEXT_ADVENTURE]: 0xff99ff,
  [QuestType.DEFENSE]: 0xff4422,
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

  private static readonly W = 520;
  private static readonly ROW_H = 60;
  private static readonly ROW_H_OFFER = 130;
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
    /** Active quests to display with countdown (US-074). */
    activeQuests: Quest[] = [],
    /** Current game day (for countdown calculation). */
    currentDay = 0,
  ) {
    this.callbacks = callbacks;
    this.container = new Container();
    const availableRows = Math.max(quests.length, 1);
    const activeRows = activeQuests.length;
    const activeSection =
      activeRows > 0 ? activeRows * JobBoardPanel.ROW_H + 36 : 0;
    const h =
      JobBoardPanel.HEAD +
      activeSection +
      availableRows * JobBoardPanel.ROW_H_OFFER +
      16;
    this.container.x = Math.round((screenWidth - JobBoardPanel.W) / 2);
    this.container.y = Math.round(Math.max(8, (screenHeight - h) / 2));
    this.render(
      quests,
      h,
      activeQuestCount,
      acceptedQuestIds,
      activeQuests,
      currentDay,
    );
  }

  private render(
    quests: GeneratedQuest[],
    h: number,
    activeQuestCount: number,
    acceptedQuestIds: ReadonlySet<string>,
    activeQuests: Quest[],
    currentDay: number,
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

    let y = JobBoardPanel.HEAD;

    // Active quests section with countdown
    if (activeQuests.length > 0) {
      this.label("АКТИВНЫЕ ЗАДАНИЯ", 16, y + 6, 13, 0xffcc44, true);
      y += 26;
      for (const q of activeQuests) {
        this.addActiveRow(q, y, W, currentDay);
        y += JobBoardPanel.ROW_H;
      }
      // Divider
      const divider = new Graphics();
      divider.rect(10, y + 2, W - 20, 1).fill({ color: 0x334466, alpha: 0.9 });
      this.container.addChild(divider);
      this.label("ДОСТУПНЫЕ ЗАДАНИЯ", 16, y + 8, 13, 0x88ccff, true);
      y += 24;
    }

    if (quests.length === 0) {
      this.label("Свободных заданий нет.", 16, y + 8, 14, 0xffaa00);
      return;
    }

    for (const q of quests) {
      const alreadyTaken = acceptedQuestIds.has(q.template.id);
      const canAccept = !atLimit && !alreadyTaken;
      this.addRow(q, y, W, canAccept, alreadyTaken);
      y += JobBoardPanel.ROW_H_OFFER;
    }
  }

  private addActiveRow(
    q: Quest,
    y: number,
    W: number,
    currentDay: number,
  ): void {
    const rowH = JobBoardPanel.ROW_H - 6;
    const color = TYPE_COLOR[q.type as QuestType] ?? 0xffffff;
    const typeLabel = TYPE_LABEL[q.type as QuestType] ?? String(q.type);

    const row = new Graphics();
    row.roundRect(10, y, W - 20, rowH, 5).fill({ color: 0x1a2a12, alpha: 0.9 });
    row.stroke({ color, width: 1, alpha: 0.5 });
    row.eventMode = "static";
    this.container.addChild(row);

    this.label(typeLabel, 20, y + 6, 11, color);

    const title = q.title.length > 28 ? q.title.slice(0, 27) + "…" : q.title;
    this.label(title, 20, y + 22, 12, 0xdddddd, true);

    // Countdown
    let countdownText: string;
    let countdownColor: number;
    if (q.deadline === 0) {
      countdownText = "Без срока";
      countdownColor = 0xaaaaaa;
    } else {
      const remaining = q.getRemainingDays(currentDay);
      if (remaining === 0) {
        countdownText = "ПРОСРОЧЕНО";
        countdownColor = 0xff2222;
      } else if (remaining <= 2) {
        countdownText = `⏱ ${remaining}д`;
        countdownColor = 0xff8844;
      } else {
        countdownText = `⏱ ${remaining}д`;
        countdownColor = 0xffcc44;
      }
    }

    const cd = new Text({
      text: countdownText,
      style: {
        fontFamily: "Courier New",
        fontSize: 11,
        fill: countdownColor,
        fontWeight: "bold",
      },
    });
    cd.eventMode = "none";
    cd.anchor.set(1, 0);
    cd.x = W - 16;
    cd.y = y + 14;
    this.container.addChild(cd);
  }

  private addRow(
    q: GeneratedQuest,
    y: number,
    W: number,
    canAccept: boolean,
    alreadyTaken: boolean,
  ): void {
    const rowH = JobBoardPanel.ROW_H_OFFER - 6;
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
    const title = t.title.length > 36 ? t.title.slice(0, 35) + "…" : t.title;
    this.label(title, 20, y + 20, 12, 0xffffff, true);

    // Issuer line: who posted the job (e.g. "— Снабженец Маклай").
    if (q.issuerName) {
      const issuer = q.issuerTitle
        ? `— ${q.issuerTitle} ${q.issuerName}`
        : `— ${q.issuerName}`;
      this.label(issuer, 20, y + 36, 10, 0x77aacc);
    }

    // Description (full text, grey, small, wrapped)
    if (t.description) {
      const descText = new Text({
        text: t.description,
        style: {
          fontFamily: "Courier New",
          fontSize: 10,
          fill: 0x889aaa,
          wordWrap: true,
          wordWrapWidth: W - 120,
        },
      });
      descText.eventMode = "none";
      descText.x = 20;
      descText.y = y + (q.issuerName ? 50 : 36);
      this.container.addChild(descText);
    }

    // Highlight tags: [Груз: медикаменты]  [Система: Альфа]  [Выдан: планета X]
    if (q.highlights.length > 0) {
      const hy = y + JobBoardPanel.ROW_H_OFFER - 30;
      const tagSpacing = 140;
      let hx = 20;
      for (const hl of q.highlights) {
        if (hx > W - 100) break;
        const tagT = new Text({
          text: `[${hl.label}: ${hl.value}]`,
          style: { fontFamily: "Courier New", fontSize: 9, fill: hl.color },
        });
        tagT.eventMode = "none";
        tagT.x = hx;
        tagT.y = hy;
        this.container.addChild(tagT);
        hx += tagSpacing;
      }
    }

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
    m.y = y + 20;
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
