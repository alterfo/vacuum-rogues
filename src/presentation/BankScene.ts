import { Container, Graphics, Rectangle } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { BankSceneHost } from "./BankSceneHost";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { scaledText } from "./ui/scaledText";
import { mountSceneHelp } from "./ui/mountSceneHelp";
import {
  MONO_CHAR_WIDTH_RATIO,
  estimateWrappedLines,
  lineStepFor,
} from "./ui/questCardLayout";
import { scaledFont } from "@/utils/fontScale";
import { INTERNAL_ACCOUNTS, type AccountType } from "@/domain/banking/Ledger";
import type { BankEvent, Unsubscribe } from "@/systems/banking/bus";
import {
  GL_COUNTERPARTY,
  adjustPlayerCredits,
} from "@/systems/banking/economy";
import {
  deposit,
  forgiveLoanResidual,
  loanAccountId,
  loanTermsSummary,
  openSavings,
  repayLoan,
  savingsAccountId,
  takeLoan,
  withdraw,
} from "@/systems/banking/products";
import {
  BANK_TOAST,
  accountTypeLabel,
  borrowBlockReason,
  describeCommand,
  describePosting,
  formatCredits,
  loanPanelLines,
  playerAccountRows,
  showBankBusPanel,
  statementRows,
  wholeCreditsToCurrent,
  type AccountRow,
  type StatementRow,
} from "./bankSceneView";

interface BankContext {
  gameEngine?: BankSceneHost;
  planet?: Planet;
  station?: Station;
}

const DEPOSIT_STEP = 1000;
const WITHDRAW_STEP = 1000;
const REPAY_STEP = 1000;
const LOAN_PRINCIPAL = 5000;
const LOAN_PERIODS = 10;

const STATEMENT_ROWS = 10;
const BUS_LOG_ROWS = 12;

const ACCENT = 0xffd24a;
const HEADER = 0x88ccff;

export class BankScene extends GameScene {
  private gameEngine: BankSceneHost | null = null;
  private planet: Planet | null = null;
  private station: Station | null = null;
  private uiContainer: Container | null = null;
  private toastTimers: ReturnType<typeof setTimeout>[] = [];
  private busLog: string[] = [];
  private busUnsub: Unsubscribe | null = null;
  private helpTeardown: (() => void) | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as BankContext | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;
    this.planet = ctx?.planet ?? null;
    this.station = ctx?.station ?? null;
    this.busLog = [];
    this.subscribeBus();
    this.render();
    this.mountHelp();
    logger.info("BankScene: open");
  }

  private mountHelp(): void {
    this.helpTeardown?.();
    this.helpTeardown = mountSceneHelp(
      { renderer: this.renderer, container: this.renderer.stage },
      "BANK",
    );
  }

  update(_dt: number): void {}

  destroy(): void {
    this.helpTeardown?.();
    this.helpTeardown = null;
    this.busUnsub?.();
    this.busUnsub = null;
    for (const t of this.toastTimers) clearTimeout(t);
    this.toastTimers = [];
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.uiContainer = null;
    this.gameEngine = null;
    this.planet = null;
    this.station = null;
  }

  private subscribeBus(): void {
    this.busUnsub?.();
    const bus = this.gameEngine?.bankBus;
    if (!bus) return;
    const unCmd = bus.observeCommands((cmd) => {
      this.pushBus(`→ ${describeCommand(cmd)}`);
    });
    const unEvt = bus.subscribe((evt: BankEvent) => {
      if (evt.kind === "TransactionPosted") {
        this.pushBus(`  ${describePosting(evt.entry)}`);
      }
    });
    this.busUnsub = () => {
      unCmd();
      unEvt();
    };
  }

  private pushBus(line: string): void {
    this.busLog.push(line);
    if (this.busLog.length > BUS_LOG_ROWS * 2) {
      this.busLog = this.busLog.slice(-BUS_LOG_ROWS * 2);
    }
  }

  private render(): void {
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();

    const w = this.renderer.app.screen.width;
    const h = this.renderer.app.screen.height;

    const bg = new Graphics();
    bg.rect(0, 0, w, h);
    bg.fill({ color: 0x000510, alpha: 0.97 });
    this.renderer.gameLayer.addChild(bg);

    const ui = new Container();
    this.uiContainer = ui;

    const title = scaledText("⛁ ГАЛАКТИЧЕСКИЙ БАНК", 24, ACCENT, {
      fontWeight: "bold",
      align: "center",
    });
    title.anchor.set(0.5, 0);
    title.x = w / 2;
    title.y = h * 0.04;
    title.eventMode = "none";
    ui.addChild(title);

    const day = this.gameEngine?.bankingService.businessDate ?? 0;
    const credits = this.gameEngine?.player?.credits ?? 0;
    const subtitle = scaledText(
      `Опер. день: ${day}     На счету: ${formatCredits(credits)}`,
      13,
      0x99bbcc,
      { align: "center" },
    );
    subtitle.anchor.set(0.5, 0);
    subtitle.x = w / 2;
    subtitle.y = h * 0.04 + 34;
    subtitle.eventMode = "none";
    ui.addChild(subtitle);

    const colTop = h * 0.16;
    const leftX = w * 0.06;
    const leftW = w * 0.4;
    const rightX = w * 0.52;
    const rightW = w * 0.42;

    this.renderAccountsAndActions(ui, leftX, colTop, leftW);
    this.renderStatementAndBus(ui, rightX, colTop, rightW, h);

    this.makeButton(
      ui,
      "[ Назад ]",
      w / 2 - 80,
      h - 56,
      160,
      36,
      0xb4b4b4,
      () => void this.goBack(),
    );

    this.renderer.uiLayer.addChild(ui);
  }

  private renderAccountsAndActions(
    ui: Container,
    x: number,
    top: number,
    width: number,
  ): void {
    let y = top;
    y = this.sectionHeader(ui, "СЧЕТА", x, y, width);

    for (const row of this.accountRows()) {
      this.renderAccountRow(ui, row, x, y, width);
      y += 40;
    }
    y += 12;

    y = this.sectionHeader(ui, "ОПЕРАЦИИ", x, y, width);
    const btnH = 34;
    const gap = 10;
    const actions: Array<{ label: string; color: number; run: () => void }> = [
      {
        label: `Внести ${formatCredits(DEPOSIT_STEP)} во вклад`,
        color: 0x44ff88,
        run: () => this.doDeposit(),
      },
      {
        label: `Снять ${formatCredits(WITHDRAW_STEP)} со вклада`,
        color: 0x66ddff,
        run: () => this.doWithdraw(),
      },
      {
        label: `Взять кредит ${formatCredits(LOAN_PRINCIPAL)}`,
        color: 0xffcc44,
        run: () => this.doTakeLoan(),
      },
      {
        label: `Погасить ${formatCredits(REPAY_STEP)}`,
        color: 0xff8866,
        run: () => this.doRepay(),
      },
    ];
    for (const a of actions) {
      this.makeButton(ui, a.label, x, y, width, btnH, a.color, a.run);
      y += btnH + gap;
    }
    y += 6;

    this.renderLoanTerms(ui, x, y, width);
  }

  private renderLoanTerms(
    ui: Container,
    x: number,
    y: number,
    width: number,
  ): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;

    const summary = loanTermsSummary({
      principal: LOAN_PRINCIPAL,
      dailyRate: engine.bankingService.loanRate,
      periods: LOAN_PERIODS,
    });
    const loanId = loanAccountId(player.id);
    const outstanding = -engine.bankingService.balanceOf(loanId);
    const arrears = engine.bankingService.loanDefaultStateOf(loanId);
    const lines = loanPanelLines(
      summary,
      outstanding,
      arrears,
      engine.bankingService.businessDate,
    );

    y = this.sectionHeader(
      ui,
      outstanding > 0 ? "КРЕДИТ — действующий" : "КРЕДИТ — условия",
      x,
      y,
      width,
    );

    const rowH = 20;
    const padY = 8;
    const panelH = padY * 2 + lines.length * rowH;
    const panel = new Graphics();
    panel
      .roundRect(x, y, width, panelH, 4)
      .fill({ color: 0x0a1424, alpha: 0.9 });
    panel
      .roundRect(x, y, width, panelH, 4)
      .stroke({ color: 0x22364e, width: 1 });
    panel.eventMode = "none";
    ui.addChild(panel);

    let ly = y + padY;
    for (const line of lines) {
      const label = scaledText(line.label, 11, 0x99bbcc);
      label.x = x + 10;
      label.y = ly;
      label.eventMode = "none";
      ui.addChild(label);

      const color =
        line.tone === "debt"
          ? 0xff8866
          : line.tone === "muted"
            ? 0xffd88a
            : 0xeaffea;
      const value = scaledText(line.value, 11, color, {
        fontWeight: "bold",
        align: "right",
      });
      value.anchor.set(1, 0);
      value.x = x + width - 10;
      value.y = ly;
      value.eventMode = "none";
      ui.addChild(value);
      ly += rowH;
    }
  }

  private renderAccountRow(
    ui: Container,
    row: AccountRow,
    x: number,
    y: number,
    width: number,
  ): void {
    const panel = new Graphics();
    panel.roundRect(x, y, width, 34, 4).fill({ color: 0x0a1424, alpha: 0.9 });
    panel.roundRect(x, y, width, 34, 4).stroke({ color: 0x22364e, width: 1 });
    panel.eventMode = "none";
    ui.addChild(panel);

    const name = scaledText(row.label, 13, HEADER, { fontWeight: "bold" });
    name.x = x + 10;
    name.y = y + 4;
    name.eventMode = "none";
    ui.addChild(name);

    const sub = scaledText(accountTypeLabel(row.type), 10, 0x778899);
    sub.x = x + 10;
    sub.y = y + 20;
    sub.eventMode = "none";
    ui.addChild(sub);

    const bal = scaledText(
      formatCredits(row.balance),
      14,
      row.balance < 0 ? 0xff8866 : 0xeaffea,
      { fontWeight: "bold", align: "right" },
    );
    bal.anchor.set(1, 0.5);
    bal.x = x + width - 10;
    bal.y = y + 17;
    bal.eventMode = "none";
    ui.addChild(bal);
  }

  private renderStatementAndBus(
    ui: Container,
    x: number,
    top: number,
    width: number,
    h: number,
  ): void {
    let y = top;
    y = this.sectionHeader(ui, "ВЫПИСКА — текущий счёт", x, y, width);

    const rows = this.statement();
    if (rows.length === 0) {
      const empty = scaledText("Пока нет операций.", 12, 0x778899);
      empty.x = x + 4;
      empty.y = y;
      empty.eventMode = "none";
      ui.addChild(empty);
      y += 22;
    }
    const statementRowStep = Math.max(22, lineStepFor(scaledFont(12)) + 5);
    for (const row of rows) {
      this.renderStatementLine(ui, row, x, y, width);
      y += statementRowStep;
    }

    if (!showBankBusPanel(__DEBUG__)) return;

    y += 16;
    y = this.sectionHeader(ui, "ШИНА: команды → проводки", x, y, width);
    const busLines = this.busLog.slice(-BUS_LOG_ROWS);
    if (busLines.length === 0) {
      const hint = scaledText(
        "Совершите операцию — она пройдёт через шину.",
        11,
        0x778899,
      );
      hint.x = x + 4;
      hint.y = y;
      hint.eventMode = "none";
      ui.addChild(hint);
    }
    for (const line of busLines) {
      const isPosting = line.trimStart().startsWith("✓");
      const t = scaledText(line, 11, isPosting ? 0x66ffaa : 0xffd88a, {
        wordWrap: true,
        wordWrapWidth: width,
      });
      t.x = x + 4;
      t.y = y;
      t.eventMode = "none";
      ui.addChild(t);
      const lines = estimateWrappedLines(line, width, scaledFont(11));
      y += lines * lineStepFor(scaledFont(11));
      if (y > h - 80) break;
    }
  }

  private renderStatementLine(
    ui: Container,
    row: StatementRow,
    x: number,
    y: number,
    width: number,
  ): void {
    const datePrefixLen = `Д${row.date}  `.length;
    const deltaClearance = 90;
    const charPx = Math.max(1, scaledFont(12) * MONO_CHAR_WIDTH_RATIO);
    const maxReasonChars = Math.max(
      6,
      Math.floor((width - deltaClearance) / charPx) - datePrefixLen,
    );
    const reason =
      row.reason.length > maxReasonChars
        ? row.reason.slice(0, Math.max(1, maxReasonChars - 1)) + "…"
        : row.reason;
    const left = scaledText(`Д${row.date}  ${reason}`, 12, 0xcfe3f5);
    left.x = x + 4;
    left.y = y;
    left.eventMode = "none";
    ui.addChild(left);

    const delta = scaledText(
      `${row.delta >= 0 ? "+" : ""}${formatCredits(row.delta)}`,
      12,
      row.delta >= 0 ? 0x66ffaa : 0xff8866,
      { align: "right" },
    );
    delta.anchor.set(1, 0);
    delta.x = x + width - 4;
    delta.y = y;
    delta.eventMode = "none";
    ui.addChild(delta);
  }

  private sectionHeader(
    ui: Container,
    label: string,
    x: number,
    y: number,
    width: number,
  ): number {
    const header = scaledText(label, 14, ACCENT, { fontWeight: "bold" });
    header.x = x;
    header.y = y;
    header.eventMode = "none";
    ui.addChild(header);

    const rule = new Graphics();
    rule.rect(x, y + 22, width, 1).fill({ color: ACCENT, alpha: 0.35 });
    rule.eventMode = "none";
    ui.addChild(rule);
    return y + 32;
  }

  private makeButton(
    parent: Container,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    onClick: () => void,
  ): void {
    const btn = new Container();
    btn.x = x;
    btn.y = y;
    btn.eventMode = "static";
    btn.cursor = "pointer";
    btn.hitArea = new Rectangle(0, 0, w, h);

    const bg = new Graphics();
    bg.roundRect(0, 0, w, h, 5).fill({ color: 0x10203a, alpha: 0.95 });
    bg.roundRect(0, 0, w, h, 5).stroke({ color, width: 1, alpha: 0.7 });
    bg.eventMode = "none";
    btn.addChild(bg);

    const lbl = scaledText(label, 13, color, {
      fontWeight: "bold",
      rawColor: true,
    });
    lbl.anchor.set(0.5);
    lbl.x = w / 2;
    lbl.y = h / 2;
    lbl.eventMode = "none";
    btn.addChild(lbl);

    btn.on("pointerdown", (e) => {
      e.stopPropagation();
      onClick();
    });
    btn.on("pointerover", () => {
      btn.alpha = 0.78;
    });
    btn.on("pointerout", () => {
      btn.alpha = 1;
    });
    parent.addChild(btn);
  }

  private accountRows(): AccountRow[] {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return [];
    const ledger = engine.bankingService.getLedger();
    return playerAccountRows(ledger, [
      player.currentAccountId,
      savingsAccountId(player.id),
      loanAccountId(player.id),
    ]);
  }

  private statement(): StatementRow[] {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return [];
    const ledger = engine.bankingService.getLedger();
    return statementRows(
      ledger.listEntries(),
      player.currentAccountId,
      STATEMENT_ROWS,
    );
  }

  private doDeposit(): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    if (player.credits < DEPOSIT_STEP) {
      this.showToast("Недостаточно средств для вклада", BANK_TOAST.error);
      return;
    }
    const sav = openSavings(engine.bankBus, engine.bankingService, player.id);
    deposit(engine.bankBus, player.currentAccountId, sav, DEPOSIT_STEP);
    this.showToast(
      `Внесено ${formatCredits(DEPOSIT_STEP)} во вклад`,
      BANK_TOAST.success,
    );
    this.render();
  }

  private doWithdraw(): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    const savId = savingsAccountId(player.id);
    const savBal = engine.bankingService.balanceOf(savId);
    const amount = wholeCreditsToCurrent(WITHDRAW_STEP, savBal);
    if (amount <= 0) {
      this.showToast("На вкладе нет средств", BANK_TOAST.error);
      return;
    }
    withdraw(engine.bankBus, savId, player.currentAccountId, amount);
    this.showToast(
      `Снято ${formatCredits(amount)} со вклада`,
      BANK_TOAST.success,
    );
    this.render();
  }

  private doTakeLoan(): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    const loanId = loanAccountId(player.id);
    const outstanding = -engine.bankingService.balanceOf(loanId);
    const block = borrowBlockReason(
      outstanding,
      engine.bankingService.loanDefaultStateOf(loanId),
    );
    if (block) {
      this.showToast(block, BANK_TOAST.warn);
      return;
    }
    takeLoan(
      engine.bankBus,
      engine.bankingService,
      player.id,
      player.currentAccountId,
      {
        principal: LOAN_PRINCIPAL,
        dailyRate: engine.bankingService.loanRate,
        periods: LOAN_PERIODS,
      },
    );
    this.showToast(
      `Кредит ${formatCredits(LOAN_PRINCIPAL)} зачислен`,
      BANK_TOAST.success,
    );
    this.render();
  }

  private doRepay(): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    const loanId = loanAccountId(player.id);
    const owed = -engine.bankingService.balanceOf(loanId); // positive when in debt
    if (owed <= 0) {
      this.showToast("Нет действующего кредита", BANK_TOAST.info);
      return;
    }
    const amount = wholeCreditsToCurrent(REPAY_STEP, owed, player.credits);
    if (amount <= 0 && owed >= 1) {
      this.showToast("Недостаточно средств для погашения", BANK_TOAST.error);
      return;
    }
    if (amount > 0) {
      repayLoan(engine.bankBus, player.currentAccountId, loanId, amount);
    }
    const residual = -engine.bankingService.balanceOf(loanId);
    if (residual > 0 && residual < 1) {
      forgiveLoanResidual(
        engine.bankBus,
        loanId,
        INTERNAL_ACCOUNTS.INTEREST_INCOME,
        residual,
      );
    }
    this.showToast(
      amount > 0 ? `Погашено ${formatCredits(amount)}` : "Кредит закрыт",
      BANK_TOAST.success,
    );
    this.render();
  }

  private async goBack(): Promise<void> {
    const engine = this.gameEngine;
    if (!engine) return;
    if (this.planet) {
      await engine.transitionTo(SceneType.PLANET, {
        gameEngine: engine,
        planet: this.planet,
      });
    } else if (this.station) {
      await engine.transitionTo(SceneType.STATION, {
        gameEngine: engine,
        station: this.station,
      });
    } else {
      await engine.transitionTo(SceneType.SPACE_FLIGHT, { gameEngine: engine });
    }
  }

  private showToast(text: string, color: number): void {
    const existing = this.uiContainer?.getChildByLabel?.("bank-toast");
    if (existing) existing.destroy();

    const toast = scaledText(text, 15, color, {
      fontWeight: "bold",
      align: "center",
      rawColor: true,
    });
    toast.label = "bank-toast";
    toast.anchor.set(0.5);
    toast.x = this.renderer.app.screen.width / 2;
    toast.y = this.renderer.app.screen.height - 92;
    toast.eventMode = "none";
    this.uiContainer?.addChild(toast);

    const handle = setTimeout(() => {
      if (!toast.destroyed) toast.destroy();
      this.toastTimers = this.toastTimers.filter((t) => t !== handle);
    }, 2500);
    this.toastTimers.push(handle);
  }

  e2eSimulateTrade(signedAmount: number, reason = "Продажа товара"): void {
    if (!__DEBUG__) return;
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    adjustPlayerCredits(
      engine.bank,
      player,
      signedAmount,
      GL_COUNTERPARTY.MARKET,
      reason,
    );
    this.render();
  }

  e2eStatement(): Array<{
    date: number;
    reason: string;
    delta: number;
    balanceAfter: number;
  }> {
    if (!__DEBUG__) return [];
    return this.statement().map((r) => ({ ...r }));
  }

  e2eAccounts(): Array<{ id: string; type: AccountType; balance: number }> {
    if (!__DEBUG__) return [];
    return this.accountRows().map((r) => ({
      id: r.id,
      type: r.type,
      balance: r.balance,
    }));
  }

  e2eDeposit(): void {
    if (!__DEBUG__) return;
    this.doDeposit();
  }

  e2eTakeLoan(): void {
    if (!__DEBUG__) return;
    this.doTakeLoan();
  }

  e2eRepayLoan(): void {
    if (!__DEBUG__) return;
    this.doRepay();
  }
}
