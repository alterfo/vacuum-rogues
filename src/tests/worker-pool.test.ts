import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebWorkerPool } from '@/ai/WebWorkerPool';

describe('WebWorkerPool', () => {
  let pool: WebWorkerPool;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (pool) {
      pool.terminate();
    }
    vi.resetAllMocks();
  });

  test('should initialize with correct pool size', () => {
    pool = new WebWorkerPool('/mock-worker.ts', 4);
    expect(pool.idleCount).toBe(4);
  });

  test('should execute task on idle worker', async () => {
    pool = new WebWorkerPool('/mock-worker.ts', 2);

    // Type for accessing private workers array
    interface PoolInternal {
      workers: Array<{ onmessage: (event: { data: unknown }) => void; terminate: () => void }>;
    }

    // Simulate worker response after initialization
    await new Promise(resolve => setTimeout(resolve, 10));

    // Mock the worker's onmessage handler
    const poolInternal = pool as unknown as PoolInternal;
    const workerInstance = poolInternal.workers[0];
    if (workerInstance) {
      setTimeout(() => {
        workerInstance.onmessage({
          data: { id: 'task_1', result: { processed: true, input: { test: 'data' } } }
        });
      }, 0);

      const result = await pool.execute({ test: 'data' });
      expect(result).toEqual({ processed: true, input: { test: 'data' } });
    }
  });

  test('should terminate all workers', () => {
    pool = new WebWorkerPool('/mock-worker.ts', 3);
    expect(pool.idleCount).toBe(3);

    pool.terminate();

    // Type for accessing private workers array
    interface PoolInternal {
      workers: Array<{ terminate: ReturnType<typeof vi.fn> }>;
    }

    const poolInternal = pool as unknown as PoolInternal;
    poolInternal.workers.forEach((w) => expect(w.terminate).toHaveBeenCalled());
  });
});
