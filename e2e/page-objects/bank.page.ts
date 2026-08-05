import { type Page } from '@playwright/test';
import { GamePageBase } from './base.page';

type BankSceneHandle = {
  e2eSimulateTrade?: (amount: number, reason?: string) => void;
  e2eStatement?: () => Array<{
    date: number;
    reason: string;
    delta: number;
    balanceAfter: number;
  }>;
  e2eAccounts?: () => Array<{ id: string; type: string; balance: number }>;
  e2eDeposit?: () => void;
  e2eTakeLoan?: () => void;
};

export class BankPage extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.page.evaluate(async () => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        transitionTo: (s: string, ctx?: object) => Promise<void>;
        galaxy: { systems: { planets: unknown[] }[] } | null;
      };
      const planet = engine.galaxy?.systems?.flatMap((s) => s.planets)?.[0];
      await engine.transitionTo('BANK', { gameEngine: engine, planet });
    });
    await this.page.waitForFunction(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: { constructor: { name: string } } | null;
      };
      return engine?.currentScene?.constructor.name === 'BankScene';
    });
  }

  async simulateTrade(amount: number, reason = 'Продажа товара'): Promise<void> {
    await this.page.evaluate(
      ([amt, why]) => {
        const engine = (window as Record<string, unknown>).__gameEngine as {
          currentScene: BankSceneHandle | null;
        };
        engine.currentScene?.e2eSimulateTrade?.(amt as number, why as string);
      },
      [amount, reason] as const,
    );
  }

  async statement(): Promise<
    Array<{ date: number; reason: string; delta: number; balanceAfter: number }>
  > {
    return this.page.evaluate(() => {
      const engine = (window as Record<string, unknown>).__gameEngine as {
        currentScene: BankSceneHandle | null;
      };
      return engine.currentScene?.e2eStatement?.() ?? [];
    });
  }
}
