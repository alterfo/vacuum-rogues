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

/**
 * Planet job board (EPIC-008 US-080): lists the quests a planet currently
 * offers; clicking a row accepts it. Text-quests are highlighted as the rare
 * "cherry". Follows the CLAUDE.md PixiJS rules (stopPropagation on rows, text
 * eventMode='none' over the clickable row background).
 */
export class JobBoardPanel {
  public readonly container: Container;
  private readonly callbacks: JobBoardCallbacks;

  private static readonly W = 440;
  private static readonly ROW_H = 54;
  private static readonly HEAD = 48;

  constructor(
    quests: GeneratedQuest[],
    screenWidth: number,
    screenHeight: number,
    callbacks: JobBoardCallbacks,
  ) {
    this.callbacks = callbacks;
    this.container = new Container();
    const rows = Math.max(quests.length, 1);
    const h = JobBoardPanel.HEAD + rows * JobBoardPanel.ROW_H + 16;
    this.container.x = Math.round((screenWidth - JobBoardPanel.W) / 2);
    this.container.y = Math.round((screenHeight - h) / 2);
    this.render(quests, h);
  }

  private render(quests: GeneratedQuest[], h: number): void {
    const W = JobBoardPanel.W;
    const bg = new Graphics();
    bg.rect(0, 0, W, h).fill({ color: 0x05101c, alpha: 0.96 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static"; // swallow clicks so they don't fall through
    this.container.addChild(bg);

    this.label("ДОСКА ЗАДАНИЙ", 16, 14, 18, 0x00ffff, true);
    this.addCloseX(W);

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
      this.addRow(q, y, W);
      y += JobBoardPanel.ROW_H;
    }
  }

  private addRow(q: GeneratedQuest, y: number, W: number): void {
    const rowH = JobBoardPanel.ROW_H - 6;
    const t = q.template;
    const color = TYPE_COLOR[t.type] ?? 0xffffff;

    const row = new Graphics();
    row.roundRect(10, y, W - 20, rowH, 5).fill({ color: 0x0e2236, alpha: 0.9 });
    row.stroke({ color, width: 1, alpha: 0.7 });
    row.eventMode = "static";
    row.cursor = "pointer";
    row.on("pointerdown", (e) => {
      e.stopPropagation();
      this.callbacks.onAccept(q);
    });
    row.on("pointerover", () => (row.alpha = 0.8));
    row.on("pointerout", () => (row.alpha = 1));
    this.container.addChild(row);

    // Title (truncated) + type tag.
    const title = t.title.length > 38 ? t.title.slice(0, 37) + "…" : t.title;
    this.label(title, 20, y + 6, 13, 0xffffff, true);

    const tag = TYPE_LABEL[t.type] ?? t.type;
    this.label(tag, 20, y + 26, 11, color);

    // Reward / deadline / distance on the right.
    const meta =
      `💰 ${t.reward.credits}` +
      (t.deadline > 0 ? `  ⏱ ${t.deadline}д` : "") +
      (q.jumps > 0 ? `  ⤴ ${q.jumps}` : "");
    const m = new Text({
      text: meta,
      style: { fontFamily: "Courier New", fontSize: 12, fill: 0xffe27a },
    });
    m.eventMode = "none";
    m.anchor.set(1, 0);
    m.x = W - 24;
    m.y = y + 16;
    this.container.addChild(m);
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
    t.eventMode = "none"; // clicks pass through to the row/background
    this.container.addChild(t);
  }

  destroy(): void {
    if (!this.container.destroyed) this.container.destroy({ children: true });
  }
}
