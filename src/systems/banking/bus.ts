import type {
  Account,
  JournalEntry,
  PostingInput,
} from "@/domain/banking/Ledger";
import { GameSystemException } from "@/exceptions/GameSystemException";

/**
 * The "универсальная шина" (universal bus / ESB) of the in-game АБС. Game systems
 * (trade, quests, repair, …) become **consumers**: they never poke the ledger
 * directly, they {@link BankBus.dispatch | dispatch} typed **commands** onto the
 * bus. A single authoritative {@link BankingService} is the bus's command
 * **handler**; it turns each command into balanced postings on the general
 * ledger and {@link BankBus.publish | publishes} **events** back onto the bus, so
 * any number of consumers (the HUD, the projection, the Bank UI's live panel) can
 * {@link BankBus.subscribe | subscribe} and react.
 *
 * Two channels, deliberately asymmetric:
 *   - **Commands** have exactly one handler (the core). `observeCommands` lets
 *     extra listeners *watch* the traffic (for the visualization panel) without
 *     becoming a second core.
 *   - **Events** are fan-out: every subscriber receives every event.
 */

// ─── Commands: consumers → the bank core ────────────────────────────────────

/** Move `amount` from one account to another (the canonical money movement). */
export interface TransferCommand {
  readonly kind: "Transfer";
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Positive magnitude moved from `from` to `to`. */
  readonly amount: number;
  readonly reason: string;
  /** Booking date; defaults to the service's current business date. */
  readonly date?: number;
  /** Value date for both legs; defaults to the booking date. */
  readonly valueDate?: number;
}

/** Escape hatch: post an arbitrary, already-balanced set of postings. */
export interface PostTransactionCommand {
  readonly kind: "PostTransaction";
  readonly postings: readonly PostingInput[];
  readonly reason: string;
  readonly date?: number;
}

/** Open a new customer or GL account on the ledger. */
export interface OpenAccountCommand {
  readonly kind: "OpenAccount";
  readonly account: Account;
}

/**
 * Apply a signed interest `amount` to `accountId`, with the counter-leg posted to
 * a GL interest account (`gl:interest_expense` for savings paid out,
 * `gl:interest_income` for loan interest earned).
 */
export interface AccrueInterestCommand {
  readonly kind: "AccrueInterest";
  readonly accountId: string;
  readonly glAccountId: string;
  /** Signed amount applied to `accountId` (the GL leg is its negation). */
  readonly amount: number;
  readonly reason?: string;
  readonly date?: number;
}

/**
 * Disburse a loan: the customer's loan account goes negative (they owe the
 * principal) and the funds land in their current account.
 */
export interface DisburseLoanCommand {
  readonly kind: "DisburseLoan";
  readonly loanAccountId: string;
  readonly toAccountId: string;
  /** Positive principal disbursed. */
  readonly amount: number;
  readonly reason?: string;
  readonly date?: number;
}

/** Run the end-of-day batch (interest accruals, statements, business-date roll). */
export interface RunEndOfDayCommand {
  readonly kind: "RunEndOfDay";
  readonly date?: number;
}

export type BankCommand =
  | TransferCommand
  | PostTransactionCommand
  | OpenAccountCommand
  | AccrueInterestCommand
  | DisburseLoanCommand
  | RunEndOfDayCommand;

// ─── Events: the bank core → consumers ──────────────────────────────────────

/** A balanced journal entry was committed to the ledger. */
export interface TransactionPostedEvent {
  readonly kind: "TransactionPosted";
  readonly entry: JournalEntry;
}

/** An account's balance moved — drives `player.credits` projection + the HUD. */
export interface BalanceChangedEvent {
  readonly kind: "BalanceChanged";
  readonly accountId: string;
  /** The account's new full balance after the posting. */
  readonly balance: number;
  /** Signed change this posting applied to the account. */
  readonly delta: number;
}

/** End-of-day cut a statement for the listed customer accounts. */
export interface StatementCutEvent {
  readonly kind: "StatementCut";
  readonly date: number;
  readonly accountIds: readonly string[];
}

export type BankEvent =
  | TransactionPostedEvent
  | BalanceChangedEvent
  | StatementCutEvent;

// ─── The bus ────────────────────────────────────────────────────────────────

export type Unsubscribe = () => void;
export type CommandHandler = (command: BankCommand) => void;
export type CommandObserver = (command: BankCommand) => void;
export type EventSubscriber = (event: BankEvent) => void;

export class BankBus {
  private handler: CommandHandler | null = null;
  private readonly commandObservers = new Set<CommandObserver>();
  private readonly eventSubscribers = new Set<EventSubscriber>();

  /**
   * Register the single authoritative command handler (the {@link BankingService}).
   * @throws GameSystemException `BANK_BUS_HANDLER_SET` if one is already registered —
   * there is exactly one core on the bus.
   */
  setHandler(handler: CommandHandler): void {
    if (this.handler) {
      throw new GameSystemException(
        "BANK_BUS_HANDLER_SET",
        "A command handler is already registered on this bus (one core per bus).",
      );
    }
    this.handler = handler;
  }

  /**
   * Send a command onto the bus: command observers see it first (for the live
   * panel), then the core handles it.
   * @throws GameSystemException `BANK_BUS_NO_HANDLER` if no core is registered.
   */
  dispatch(command: BankCommand): void {
    for (const observe of this.commandObservers) observe(command);
    if (!this.handler) {
      throw new GameSystemException(
        "BANK_BUS_NO_HANDLER",
        `No handler registered for command "${command.kind}".`,
        { kind: command.kind },
      );
    }
    this.handler(command);
  }

  /** Watch command traffic without handling it (visualization). Returns an unsubscribe. */
  observeCommands(observer: CommandObserver): Unsubscribe {
    this.commandObservers.add(observer);
    return () => {
      this.commandObservers.delete(observer);
    };
  }

  /** Fan an event out to every subscriber. Called by the core. */
  publish(event: BankEvent): void {
    for (const subscriber of this.eventSubscribers) subscriber(event);
  }

  /** Subscribe to all events. Returns an unsubscribe. */
  subscribe(subscriber: EventSubscriber): Unsubscribe {
    this.eventSubscribers.add(subscriber);
    return () => {
      this.eventSubscribers.delete(subscriber);
    };
  }
}
