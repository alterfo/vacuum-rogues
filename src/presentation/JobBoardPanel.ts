import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { attachWheelScroll } from "./ui/WheelScroll";
import { scaledText } from "./ui/scaledText";
import { scaledFont } from "@/utils/fontScale";
import {
  computeRowLayout,
  TOP_PAD,
  type RowLayout,
} from "./ui/jobBoardRowLayout";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { Quest } from "@/domain/Quest";
import { QuestType } from "@/types";
import { t } from "@/i18n/i18n";
import {
  boardHead,
  scrollArrowOffset,
  highlightTagXs,
  HIGHLIGHT_TAG_BASE_PX,
  BOARD_TITLE_BASE_PX,
  BOARD_NOTE_BASE_PX,
  SCROLL_HINT_BASE_PX,
  SCROLL_ARROW_BASE_PX,
} from "./ui/jobBoardChrome";

export interface JobBoardCallbacks {
  onAccept: (quest: GeneratedQuest) => void;
  onClose: () => void;
}

export function questTypeLabel(type: QuestType): string {
  return t(`quest.type.${type}`);
}

const TYPE_COLOR: Record<QuestType, number> = {
  [QuestType.DELIVERY]: 0x88ccff,
  [QuestType.BOUNTY]: 0xff6666,
  [QuestType.ESCORT]: 0x88ff88,
  [QuestType.DIPLOMACY]: 0xffcc66,
  [QuestType.EXPLORATION]: 0x66ddff,
  [QuestType.TEXT_ADVENTURE]: 0xff99ff,
  [QuestType.DEFENSE]: 0xff4422,
};

export const MAX_ACTIVE_QUESTS = 3;

export class JobBoardPanel {
  public readonly container: Container;
  public panelHeight = 0;
  private readonly callbacks: JobBoardCallbacks;

  private offersContainer: Container | null = null;
  private offersHitArea: Rectangle | null = null;
  private offerAreaTopPx = 0;
  private offerScrollOffset = 0;
  private scrollUpBtn: Text | null = null;
  private scrollDownBtn: Text | null = null;
  private detachWheel: (() => void) | null = null;

  private static readonly W = 520;
  private static readonly SCROLL_BAR_H = 26;
  private static readonly ROW_GAP = 6;
  private static readonly MIN_OFFER_ROW_H = 124;
  private static readonly MIN_ACTIVE_ROW_H = 54;
  private static readonly OFFER_WRAP_WIDTH = JobBoardPanel.W - 120;
  private static readonly ACTIVE_WRAP_WIDTH = JobBoardPanel.W - 140;
  private offerRowOffsets: number[] = [];

  constructor(
    quests: GeneratedQuest[],
    screenWidth: number,
    screenHeight: number,
    callbacks: JobBoardCallbacks,
    activeQuestCount = 0,
    acceptedQuestIds: ReadonlySet<string> = new Set(),
    activeQuests: Quest[] = [],
    currentDay = 0,
    playerRank = 0,
  ) {
    this.callbacks = callbacks;
    this.container = new Container();

    const offerLayouts = quests.map((q) => JobBoardPanel.offerRowLayout(q));
    const activeLayouts = activeQuests.map((q) =>
      JobBoardPanel.activeRowLayout(q),
    );

    const activeSlotSum = activeLayouts.reduce(
      (sum, l) => sum + l.contentHeight + JobBoardPanel.ROW_GAP,
      0,
    );
    const activeSection = activeQuests.length > 0 ? activeSlotSum + 36 : 0;
    const offerSlotSum = offerLayouts.reduce(
      (sum, l) => sum + l.contentHeight + JobBoardPanel.ROW_GAP,
      0,
    );
    const offersHeight =
      quests.length > 0
        ? offerSlotSum
        : JobBoardPanel.MIN_OFFER_ROW_H + JobBoardPanel.ROW_GAP;
    const head = boardHead(activeQuestCount >= MAX_ACTIVE_QUESTS);
    const fullH = head.height + activeSection + offersHeight + 16;

    const h = Math.min(fullH, screenHeight - 16);
    this.panelHeight = h;
    this.container.x = Math.round((screenWidth - JobBoardPanel.W) / 2);
    this.container.y = Math.round(Math.max(8, (screenHeight - h) / 2));
    this.render(
      quests,
      h,
      activeQuestCount,
      acceptedQuestIds,
      activeQuests,
      currentDay,
      playerRank,
      offerLayouts,
      activeLayouts,
    );
  }

  private static offerRowLayout(q: GeneratedQuest): RowLayout {
    return computeRowLayout(
      {
        title: q.template.title,
        hasIssuer: !!q.issuerName,
        description: q.template.description ?? "",
        hasHighlights: q.highlights.length > 0,
      },
      {
        wrapWidth: JobBoardPanel.OFFER_WRAP_WIDTH,
        tagFontPx: scaledFont(11),
        metaFontPx: scaledFont(13),
        titleFontPx: scaledFont(12),
        issuerFontPx: scaledFont(10),
        descFontPx: scaledFont(13),
        highlightsFontPx: scaledFont(11),
        minHeight: JobBoardPanel.MIN_OFFER_ROW_H,
      },
    );
  }

  private static activeRowLayout(q: Quest): RowLayout {
    return computeRowLayout(
      {
        title: q.title,
        hasIssuer: false,
        description: "",
        hasHighlights: false,
      },
      {
        wrapWidth: JobBoardPanel.ACTIVE_WRAP_WIDTH,
        tagFontPx: scaledFont(11),
        metaFontPx: scaledFont(11),
        titleFontPx: scaledFont(12),
        issuerFontPx: scaledFont(10),
        descFontPx: scaledFont(13),
        highlightsFontPx: scaledFont(11),
        minHeight: JobBoardPanel.MIN_ACTIVE_ROW_H,
      },
    );
  }

  private render(
    quests: GeneratedQuest[],
    h: number,
    activeQuestCount: number,
    acceptedQuestIds: ReadonlySet<string>,
    activeQuests: Quest[],
    currentDay: number,
    playerRank = 0,
    offerLayouts: RowLayout[] = [],
    activeLayouts: RowLayout[] = [],
  ): void {
    const W = JobBoardPanel.W;
    const bg = new Graphics();
    bg.rect(0, 0, W, h).fill({ color: 0x05101c, alpha: 0.96 });
    bg.stroke({ color: 0x00ffff, width: 2 });
    bg.eventMode = "static";
    this.container.addChild(bg);

    const head = boardHead(activeQuestCount >= MAX_ACTIVE_QUESTS);
    this.label(
      t("jobBoard.title"),
      16,
      head.titleY,
      BOARD_TITLE_BASE_PX,
      0x00ffff,
      true,
      this.container,
      true,
    );
    this.addCloseX(W);

    const atLimit = activeQuestCount >= MAX_ACTIVE_QUESTS;
    if (atLimit) {
      this.label(
        t("jobBoard.maxQuests", { max: MAX_ACTIVE_QUESTS }),
        16,
        head.noteY,
        BOARD_NOTE_BASE_PX,
        0xff8844,
        false,
        this.container,
        true,
      );
    }

    let y = head.height;

    if (activeQuests.length > 0) {
      this.label(
        t("jobBoard.activeQuests"),
        16,
        y + 6,
        13,
        0xffcc44,
        true,
        this.container,
        true,
      );
      y += 26;
      activeQuests.forEach((q, i) => {
        const layout = activeLayouts[i];
        this.addActiveRow(q, y, W, currentDay, layout);
        y += layout.contentHeight + JobBoardPanel.ROW_GAP;
      });
      const divider = new Graphics();
      divider.rect(10, y + 2, W - 20, 1).fill({ color: 0x334466, alpha: 0.9 });
      this.container.addChild(divider);
      this.label(
        t("jobBoard.availableQuests"),
        16,
        y + 8,
        13,
        0x88ccff,
        true,
        this.container,
        true,
      );
      y += 24;
    }

    if (quests.length === 0) {
      this.label(
        t("jobBoard.noQuests"),
        16,
        y + 8,
        14,
        0xffaa00,
        false,
        this.container,
        true,
      );
      return;
    }

    const offerAreaTop = y;
    const bottomPad = 8;
    const offerSlots = offerLayouts.map(
      (l) => l.contentHeight + JobBoardPanel.ROW_GAP,
    );
    const offerRowOffsets: number[] = [];
    let offerAcc = 0;
    for (const slot of offerSlots) {
      offerRowOffsets.push(offerAcc);
      offerAcc += slot;
    }
    this.offerRowOffsets = offerRowOffsets;
    const contentHeight = offerAcc;
    let offerAreaHeight = h - offerAreaTop - bottomPad;
    const overflows = contentHeight > offerAreaHeight;
    if (overflows) {
      offerAreaHeight -= JobBoardPanel.SCROLL_BAR_H;
    }
    let visibleRows = 1;
    if (offerSlots.length > 0) {
      let sum = 0;
      let count = 0;
      for (let i = offerSlots.length - 1; i >= 0; i--) {
        if (count > 0 && sum + offerSlots[i] > offerAreaHeight) break;
        sum += offerSlots[i];
        count++;
      }
      visibleRows = Math.max(1, count);
    }
    const maxScroll = Math.max(0, quests.length - visibleRows);

    const mask = new Graphics();
    mask
      .rect(10, offerAreaTop, W - 20, offerAreaHeight)
      .fill({ color: 0xffffff });
    this.container.addChild(mask);

    const offers = new Container();
    offers.mask = mask;
    this.container.addChild(offers);
    this.offersContainer = offers;

    this.offerAreaTopPx = offerAreaTop;
    this.offersHitArea = new Rectangle(
      10,
      offerAreaTop,
      W - 20,
      offerAreaHeight,
    );
    offers.hitArea = this.offersHitArea;

    quests.forEach((q, i) => {
      const alreadyTaken = acceptedQuestIds.has(q.template.id);
      const minRank = q.template.minRank ?? 0;
      const rankBlocked = minRank > 0 && playerRank < minRank;
      const canAccept = !atLimit && !alreadyTaken && !rankBlocked;
      this.addRow(
        q,
        y,
        W,
        canAccept,
        alreadyTaken,
        offerLayouts[i],
        rankBlocked ? minRank : 0,
        offers,
      );
      y += offerSlots[i];
    });

    if (maxScroll > 0) {
      this.addScrollControls(W, offerAreaTop + offerAreaHeight + 2, maxScroll);
      this.detachWheel = attachWheelScroll((dir) =>
        this.scrollOffers(dir, maxScroll),
      );
    }
  }

  public scrollOffers(delta: number, maxOffset: number): void {
    const next = Math.max(
      0,
      Math.min(maxOffset, this.offerScrollOffset + delta),
    );
    if (next === this.offerScrollOffset) return;
    this.offerScrollOffset = next;
    const offsetPx = this.offerRowOffsets[next] ?? 0;
    if (this.offersContainer) {
      this.offersContainer.y = -offsetPx || 0;
      if (this.offersHitArea) {
        this.offersHitArea.y = this.offerAreaTopPx + offsetPx;
      }
    }
    this.updateScrollArrows(maxOffset);
  }

  private addScrollControls(W: number, barY: number, maxScroll: number): void {
    const makeArrow = (glyph: string, dx: number, dir: number): Text => {
      const t = scaledText(glyph, SCROLL_ARROW_BASE_PX, 0x66ccff, {
        fontWeight: "bold",
      });
      t.anchor.set(0.5);
      t.x = W / 2 + dx;
      t.y = barY + 10;
      t.eventMode = "static";
      t.cursor = "pointer";
      t.on("pointerdown", (e) => {
        e.stopPropagation();
        this.scrollOffers(dir, maxScroll);
      });
      this.container.addChild(t);
      return t;
    };
    const hintText = t("jobBoard.scrollHint");
    const arrowDx = scrollArrowOffset(hintText);
    this.scrollUpBtn = makeArrow("▲", -arrowDx, -1);
    this.scrollDownBtn = makeArrow("▼", arrowDx, 1);

    const hint = scaledText(hintText, SCROLL_HINT_BASE_PX, 0x668899);
    hint.anchor.set(0.5);
    hint.x = W / 2;
    hint.y = barY + 10;
    hint.eventMode = "none";
    this.container.addChild(hint);

    this.updateScrollArrows(maxScroll);
  }

  private updateScrollArrows(maxScroll: number): void {
    if (this.scrollUpBtn) {
      this.scrollUpBtn.alpha = this.offerScrollOffset > 0 ? 1 : 0.3;
    }
    if (this.scrollDownBtn) {
      this.scrollDownBtn.alpha = this.offerScrollOffset < maxScroll ? 1 : 0.3;
    }
  }

  private addActiveRow(
    q: Quest,
    y: number,
    W: number,
    currentDay: number,
    layout: RowLayout,
  ): void {
    const rowH = layout.contentHeight;
    const color = TYPE_COLOR[q.type as QuestType] ?? 0xffffff;
    const typeLabel = questTypeLabel(q.type as QuestType);

    const row = new Graphics();
    row.roundRect(10, y, W - 20, rowH, 5).fill({ color: 0x1a2a12, alpha: 0.9 });
    row.stroke({ color, width: 1, alpha: 0.5 });
    row.eventMode = "static";
    this.container.addChild(row);

    this.label(
      typeLabel,
      20,
      y + TOP_PAD,
      11,
      color,
      false,
      this.container,
      true,
    );

    const titleT = scaledText(q.title, 12, 0xdddddd, {
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: JobBoardPanel.ACTIVE_WRAP_WIDTH,
    });
    titleT.eventMode = "none";
    titleT.x = 20;
    titleT.y = y + layout.titleY;
    this.container.addChild(titleT);

    let countdownText: string;
    let countdownColor: number;
    if (q.deadline === 0) {
      countdownText = t("jobBoard.noDeadline");
      countdownColor = 0xaaaaaa;
    } else {
      const remaining = q.getRemainingDays(currentDay);
      if (remaining === 0) {
        countdownText = t("jobBoard.expired");
        countdownColor = 0xff2222;
      } else if (remaining <= 2) {
        countdownText = t("jobBoard.daysLeft", { days: remaining });
        countdownColor = 0xff8844;
      } else {
        countdownText = t("jobBoard.daysLeft", { days: remaining });
        countdownColor = 0xffcc44;
      }
    }

    const cd = scaledText(countdownText, 11, countdownColor, {
      fontWeight: "bold",
      rawColor: true,
    });
    cd.eventMode = "none";
    cd.anchor.set(1, 0);
    cd.x = W - 16;
    cd.y = y + TOP_PAD;
    this.container.addChild(cd);
  }

  private addRow(
    q: GeneratedQuest,
    y: number,
    W: number,
    canAccept: boolean,
    alreadyTaken: boolean,
    layout: RowLayout,
    requiredRank = 0,
    parent: Container = this.container,
  ): void {
    const rowH = layout.contentHeight;
    const tpl = q.template;
    const color = TYPE_COLOR[tpl.type] ?? 0xffffff;

    const row = new Graphics();
    row.roundRect(10, y, W - 20, rowH, 5).fill({ color: 0x0e2236, alpha: 0.9 });
    row.stroke({ color, width: 1, alpha: 0.7 });
    row.eventMode = "static";
    parent.addChild(row);

    const tag = questTypeLabel(tpl.type);
    this.label(tag, 20, y + TOP_PAD, 11, color, false, parent, true);

    const titleT = scaledText(tpl.title, 12, 0xffffff, {
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: JobBoardPanel.OFFER_WRAP_WIDTH,
    });
    titleT.eventMode = "none";
    titleT.x = 20;
    titleT.y = y + layout.titleY;
    parent.addChild(titleT);

    if (q.issuerName) {
      const issuer = q.issuerTitle
        ? `— ${q.issuerTitle} ${q.issuerName}`
        : `— ${q.issuerName}`;
      this.label(issuer, 20, y + layout.issuerY, 10, 0x77aacc, false, parent);
    }

    if (tpl.description) {
      const descText = scaledText(tpl.description, 13, 0x889aaa, {
        wordWrap: true,
        wordWrapWidth: JobBoardPanel.OFFER_WRAP_WIDTH,
      });
      descText.eventMode = "none";
      descText.x = 20;
      descText.y = y + layout.descY;
      parent.addChild(descText);
    }

    if (q.highlights.length > 0) {
      const hy = y + layout.highlightsY;
      const texts = q.highlights.map((hl) => `[${hl.label}: ${hl.value}]`);
      const xs = highlightTagXs(texts, 20, W - 96);
      xs.forEach((hx, i) => {
        const tagT = scaledText(
          texts[i],
          HIGHLIGHT_TAG_BASE_PX,
          q.highlights[i].color,
          { rawColor: true },
        );
        tagT.eventMode = "none";
        tagT.x = hx;
        tagT.y = hy;
        parent.addChild(tagT);
      });
    }

    const deadlineDays =
      tpl.deadline > 0
        ? `  ${t("jobBoard.daysLeft", { days: tpl.deadline })}`
        : "";
    const jumpsText = q.jumps > 0 ? `  ⤴ ${q.jumps}` : "";
    const meta = `💰 ${tpl.reward.credits}${deadlineDays}${jumpsText}`;
    const m = scaledText(meta, 13, 0xffe27a, { rawColor: true });
    m.eventMode = "none";
    m.anchor.set(1, 0);
    m.x = W - 90;
    m.y = y + TOP_PAD;
    parent.addChild(m);

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
    parent.addChild(btnBg);

    const isRankBlocked = requiredRank > 0 && !alreadyTaken && !canAccept;
    const btnLabel = alreadyTaken
      ? t("jobBoard.accepted")
      : canAccept
        ? t("jobBoard.accept")
        : isRankBlocked
          ? t("jobBoard.requireRank", { rank: requiredRank })
          : t("jobBoard.busy");
    const btnLbl = scaledText(
      btnLabel,
      11,
      alreadyTaken ? 0x44aa66 : canAccept ? 0x00ffaa : 0x555555,
      { fontWeight: "bold", rawColor: true },
    );
    btnLbl.eventMode = "none";
    btnLbl.anchor.set(0.5);
    btnLbl.x = btnX + btnW / 2;
    btnLbl.y = btnY + btnH / 2;
    parent.addChild(btnLbl);
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

    const x = scaledText("✕", 16, 0xff6666, {
      fontWeight: "bold",
      rawColor: true,
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
    parent: Container = this.container,
    raw = false,
  ): void {
    const t = scaledText(text, size, color, {
      fontWeight: bold ? "bold" : "normal",
      ...(raw ? { rawColor: true } : {}),
    });
    t.x = x;
    t.y = y;
    t.eventMode = "none";
    parent.addChild(t);
  }

  destroy(): void {
    if (this.detachWheel) {
      this.detachWheel();
      this.detachWheel = null;
    }
    if (!this.container.destroyed) this.container.destroy({ children: true });
  }
}
