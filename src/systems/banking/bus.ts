import type {
  Account,
  JournalEntry,
  PostingInput,
} from "@/domain/banking/Ledger";
import { GameSystemException } from "@/exceptions/GameSystemException";

export interface TransferCommand {
  readonly kind: "Transfer";
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: number;
  readonly reason: string;
  readonly date?: number;
  readonly valueDate?: number;
}

export interface PostTransactionCommand {
  readonly kind: "PostTransaction";
  readonly postings: readonly PostingInput[];
  readonly reason: string;
  readonly date?: number;
}

export interface OpenAccountCommand {
  readonly kind: "OpenAccount";
  readonly account: Account;
}

export interface AccrueInterestCommand {
  readonly kind: "AccrueInterest";
  readonly accountId: string;
  readonly glAccountId: string;
  readonly amount: number;
  readonly reason?: string;
  readonly date?: number;
}

export interface DisburseLoanCommand {
  readonly kind: "DisburseLoan";
  readonly loanAccountId: string;
  readonly toAccountId: string;
  readonly amount: number;
  readonly reason?: string;
  readonly date?: number;
}

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

export interface TransactionPostedEvent {
  readonly kind: "TransactionPosted";
  readonly entry: JournalEntry;
}

export interface BalanceChangedEvent {
  readonly kind: "BalanceChanged";
  readonly accountId: string;
  readonly balance: number;
  readonly delta: number;
}

export interface StatementCutEvent {
  readonly kind: "StatementCut";
  readonly date: number;
  readonly accountIds: readonly string[];
}

export interface LoanDefaultedEvent {
  readonly kind: "LoanDefaulted";
  readonly ownerId: string;
  readonly loanAccountId: string;
  readonly missedPayments: number;
  readonly outstanding: number;
}

export type BankEvent =
  | TransactionPostedEvent
  | BalanceChangedEvent
  | StatementCutEvent
  | LoanDefaultedEvent;

export type Unsubscribe = () => void;
export type CommandHandler = (command: BankCommand) => void;
export type CommandObserver = (command: BankCommand) => void;
export type EventSubscriber = (event: BankEvent) => void;

export class BankBus {
  private handler: CommandHandler | null = null;
  private readonly commandObservers = new Set<CommandObserver>();
  private readonly eventSubscribers = new Set<EventSubscriber>();

  setHandler(handler: CommandHandler): void {
    if (this.handler) {
      throw new GameSystemException(
        "BANK_BUS_HANDLER_SET",
        "A command handler is already registered on this bus (one core per bus).",
      );
    }
    this.handler = handler;
  }

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

  observeCommands(observer: CommandObserver): Unsubscribe {
    this.commandObservers.add(observer);
    return () => {
      this.commandObservers.delete(observer);
    };
  }

  publish(event: BankEvent): void {
    for (const subscriber of this.eventSubscribers) subscriber(event);
  }

  subscribe(subscriber: EventSubscriber): Unsubscribe {
    this.eventSubscribers.add(subscriber);
    return () => {
      this.eventSubscribers.delete(subscriber);
    };
  }
}
