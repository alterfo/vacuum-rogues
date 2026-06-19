import { Container, Graphics, Rectangle, Text } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import type { Planet } from "@/domain/Planet";
import type { Station } from "@/domain/Station";
import { SceneType } from "@/types";
import { logger } from "@/utils/logger";
import { scaledText } from "./ui/scaledText";
import { INTERNAL_ACCOUNTS, type AccountType } from "@/domain/banking/Ledger";
import type { BankEvent } from "@/systems/banking/bus";
import type { Unsubscribe } from "@/systems/banking/bus";
import { DEFAULT_LOAN_DAILY_RATE } from "@/systems/banking/BankingService";
import {
  GL_COUNTERPARTY,
  adjustPlayerCredits,
} from "@/systems/banking/economy";
import {
  deposit,
  forgiveLoanResidual,
  loanAccountId,
  openSavings,
  repayLoan,
  savingsAccountId,
  takeLoan,
  withdraw,
} from "@/systems/banking/products";
import {
  accountTypeLabel,
  describeCommand,
  describePosting,
  formatCredits,
  playerAccountRows,
  statementRows,
  wholeCreditsToCurrent,
  type AccountRow,
  type StatementRow,
} from "./bankSceneView";

interface BankContext {
  gameEngine?: GameEngine;
  /** Where the player came from — Bank returns here on "Назад". */
  planet?: Planet;
  station?: Station;
}

/** Demo-thin operation sizes (the products themselves are generic; see products.ts). */
const DEPOSIT_STEP = 1000;
const WITHDRAW_STEP = 1000;
const REPAY_STEP = 1000;
const LOAN_PRINCIPAL = 5000;
const LOAN_PERIODS = 10;

/** How many recent rows the statement and the live bus log show. */
const STATEMENT_ROWS = 10;
const BUS_LOG_ROWS = 12;

const ACCENT = 0xffd24a;
const HEADER = 0x88ccff;

/**
 * Галактический Банк — the player-facing payoff for the in-game АБС (Task 7).
 * It is purely a *consumer* of the bus + a reader of the ledger: it never pokes
 * the ledger directly. Three panels make the core-banking architecture visible:
 *
 *  - **Счета** — the player's customer accounts (current / savings / loan) with
 *    their live GL balances, plus thin deposit / withdraw / loan / repay actions
 *    (each a balanced command on the bus via the products facade).
 *  - **Выписка** — a statement of the current account built straight from the
 *    journal: every entry that touched it, with its net effect and a running
 *    balance (so a recent trade/reward shows up as a posting).
 *  - **Шина** — a live "команды → проводки" log: every command observed on the
 *    bus and the journal entry it produced, the teaching artifact for the demo.
 *
 * Balances/statement come from {@link bankSceneView} (pure, unit-tested); the
 * scene just maps those rows to `Text`/`Graphics`.
 */
export class BankScene extends GameScene {
  private gameEngine: GameEngine | null = null;
  private planet: Planet | null = null;
  private station: Station | null = null;
  private uiContainer: Container | null = null;
  private toastTimers: ReturnType<typeof setTimeout>[] = [];
  /** Rolling live log of bus traffic since the screen opened (newest last). */
  private busLog: string[] = [];
  private busUnsub: Unsubscribe | null = null;

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
    logger.info("BankScene: open");
  }

  update(_dt: number): void {}

  destroy(): void {
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

  /**
   * Watch the bus so the Шина panel reflects live traffic: every command the
   * scene's own actions dispatch is logged as `→ command`, and the journal entry
   * it commits is logged as `✓ posting`. Only mutates {@link busLog}; the action
   * handlers re-render after dispatching, so the new lines appear immediately.
   */
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

  // ── Render ─────────────────────────────────────────────────────────────────

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

    // Title + business-date / credits strip.
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

    // Back button.
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

  /** Left column: accounts list + the four product actions. */
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

  /** Right column: current-account statement (top) + the live bus log (bottom). */
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
    for (const row of rows) {
      this.renderStatementLine(ui, row, x, y, width);
      y += 22;
    }

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
      y += 18;
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
    const reason =
      row.reason.length > 30 ? row.reason.slice(0, 29) + "…" : row.reason;
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
    // Children are all eventMode='none', so the container needs an explicit
    // hitArea or the event boundary prunes it (pixi-rules.md).
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

  // ── Data (via the pure view-model) ───────────────────────────────────────────

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

  // ── Actions (each a balanced command on the bus) ─────────────────────────────

  private doDeposit(): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    if (player.credits < DEPOSIT_STEP) {
      this.showToast("Недостаточно средств для вклада", 0xff8866);
      return;
    }
    const sav = openSavings(engine.bankBus, engine.bankingService, player.id);
    deposit(engine.bankBus, player.currentAccountId, sav, DEPOSIT_STEP);
    this.showToast(`Внесено ${formatCredits(DEPOSIT_STEP)} во вклад`, 0x44ff88);
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
      this.showToast("На вкладе нет средств", 0xff8866);
      return;
    }
    withdraw(engine.bankBus, savId, player.currentAccountId, amount);
    this.showToast(`Снято ${formatCredits(amount)} со вклада`, 0x66ddff);
    this.render();
  }

  private doTakeLoan(): void {
    const engine = this.gameEngine;
    const player = engine?.player;
    if (!engine || !player) return;
    const loanId = loanAccountId(player.id);
    if (engine.bankingService.balanceOf(loanId) < 0) {
      this.showToast("Сначала погасите текущий кредит", 0xffcc44);
      return;
    }
    takeLoan(
      engine.bankBus,
      engine.bankingService,
      player.id,
      player.currentAccountId,
      {
        principal: LOAN_PRINCIPAL,
        dailyRate: DEFAULT_LOAN_DAILY_RATE,
        periods: LOAN_PERIODS,
      },
    );
    this.showToast(
      `Кредит ${formatCredits(LOAN_PRINCIPAL)} зачислен`,
      0xffcc44,
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
      this.showToast("Нет действующего кредита", 0x66ddff);
      return;
    }
    // Whole credits we can move off the integer-only current account this press.
    const amount = wholeCreditsToCurrent(REPAY_STEP, owed, player.credits);
    if (amount <= 0 && owed >= 1) {
      // A whole credit of debt remains but the player has no funds to pay it.
      this.showToast("Недостаточно средств для погашения", 0xff8866);
      return;
    }
    if (amount > 0) {
      repayLoan(engine.bankBus, player.currentAccountId, loanId, amount);
    }
    // Whatever sub-credit residual remains (EOD interest leaves the loan balance
    // fractional, and a Transfer can only move whole credits onto the current
    // account) is written off so the loan closes at exactly 0 — otherwise it
    // would stay permanently negative and block every future loan.
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
      0xff8866,
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

    const toast = new Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 15,
        fill: color,
        fontWeight: "bold",
        align: "center",
      },
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

  // ── E2E seams (CLAUDE.md: scene-owned, __DEBUG__-guarded) ────────────────────

  /**
   * Book a market posting through the *real* production credit facade
   * ({@link adjustPlayerCredits} → bus → ledger), so an e2e can show "a trade
   * shows up as a posting" without standing up the whole market UI. Positive =
   * a sale (credit), negative = a purchase (debit).
   */
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

  /** Current-account statement rows (for e2e assertions). */
  e2eStatement(): Array<{
    date: number;
    reason: string;
    delta: number;
    balanceAfter: number;
  }> {
    if (!__DEBUG__) return [];
    return this.statement().map((r) => ({ ...r }));
  }

  /** Customer account balances by type (for e2e assertions). */
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
}
