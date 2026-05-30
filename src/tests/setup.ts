// Mock Web Worker for jsdom environment
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;

  constructor(_scriptURL: string, _options?: { type?: 'module' }) {
    // Mock constructor
  }

  postMessage(_data: unknown): void {
    // Mock method
  }

  terminate(): void {
    // Mock method
  }
}

// @ts-expect-error - Mock Worker for jsdom
global.Worker = MockWorker;
