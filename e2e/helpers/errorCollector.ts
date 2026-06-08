import type { Page, ConsoleMessage } from '@playwright/test';
import { expect } from '@playwright/test';

export class ErrorCollector {
  private errors: string[] = [];
  private consoleListener: (msg: ConsoleMessage) => void;
  private pageErrorListener: (err: Error) => void;

  constructor(private page: Page) {
    this.consoleListener = (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        this.errors.push(`[console.error] ${msg.text()}`);
      } else if (msg.type() === 'log' || msg.type() === 'warn') {
        const text = msg.text();
        if (text.startsWith('[ERROR]')) {
          this.errors.push(`[logger.error] ${text}`);
        }
      }
    };
    this.pageErrorListener = (err: Error) => {
      this.errors.push(`[pageerror] ${err.message}`);
    };
    this.page.on('console', this.consoleListener);
    this.page.on('pageerror', this.pageErrorListener);
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  clear(): void {
    this.errors = [];
  }

  assertNoErrors(excludePatterns: string[] = []): void {
    const relevant = this.errors.filter(
      (e) =>
        !excludePatterns.some((p) => e.includes(p)) &&
        !e.includes('favicon') &&
        !e.includes('MIME type') &&
        !e.includes('ServiceWorker')
    );
    expect(relevant, `Unexpected JS errors:\n${relevant.join('\n')}`).toHaveLength(0);
  }

  assertAndDetach(excludePatterns: string[] = []): void {
    try {
      this.assertNoErrors(excludePatterns);
    } finally {
      this.detach();
    }
  }

  detach(): void {
    this.page.off('console', this.consoleListener);
    this.page.off('pageerror', this.pageErrorListener);
  }
}
