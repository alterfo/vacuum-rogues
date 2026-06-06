import { logger } from "@/utils/logger";

interface WorkerTask {
  readonly id: string;
  readonly data: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class WebWorkerPool {
  private workers: Worker[] = [];
  private queue: WorkerTask[] = [];
  private activeTasks = new Map<number, WorkerTask>();
  private taskIdCounter = 0;

  constructor(
    private readonly workerScript: string,
    private readonly poolSize = 4,
  ) {
    this.initialize();
  }

  private initialize(): void {
    for (let i = 0; i < this.poolSize; i++) {
      this.addWorker(i);
    }
  }

  private addWorker(index: number): void {
    try {
      const worker = new Worker(this.workerScript, { type: "module" });
      worker.onmessage = (event) => this.handleMessage(index, event);
      worker.onerror = (error) => this.handleError(index, error);
      this.workers[index] = worker;
    } catch (e) {
      logger.error(`Failed to create worker ${index}:`, e);
    }
  }

  private handleMessage(workerIndex: number, event: MessageEvent): void {
    const task = this.activeTasks.get(workerIndex);
    if (!task) return;

    this.activeTasks.delete(workerIndex);

    if (event.data.error) {
      task.reject(new Error(event.data.error));
    } else {
      task.resolve(event.data.result);
    }

    this.processQueue(workerIndex);
  }

  private handleError(workerIndex: number, error: ErrorEvent): void {
    const task = this.activeTasks.get(workerIndex);
    if (task) {
      this.activeTasks.delete(workerIndex);
      task.reject(new Error(error.message));
    }
    logger.error(`Worker ${workerIndex} error:`, error);
    this.addWorker(workerIndex);
  }

  private processQueue(workerIndex: number): void {
    if (this.queue.length === 0) return;
    const task = this.queue.shift()!;
    this.activeTasks.set(workerIndex, task);
    this.workers[workerIndex].postMessage({ id: task.id, data: task.data });
  }

  /**
   * Broadcast a model buffer to every worker so each one can create its own
   * InferenceSession. Uses structured clone (not transfer) so the buffer
   * remains usable on the main thread after the call.
   */
  loadModel(modelId: string, buffer: ArrayBuffer): Promise<void[]> {
    const tasks = this.workers.map(
      (worker) =>
        new Promise<void>((resolve, reject) => {
          const taskId = `load_${modelId}_${++this.taskIdCounter}`;
          const onMessage = (event: MessageEvent) => {
            if (event.data.id !== taskId) return;
            worker.removeEventListener("message", onMessage);
            if (event.data.error) {
              reject(new Error(event.data.error));
            } else {
              resolve();
            }
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({
            id: taskId,
            data: { modelId, modelBuffer: buffer },
          });
        }),
    );
    return Promise.all(tasks);
  }

  execute(data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: `task_${++this.taskIdCounter}`,
        data,
        resolve,
        reject,
      };

      // Find idle worker
      for (let i = 0; i < this.workers.length; i++) {
        if (!this.activeTasks.has(i)) {
          this.activeTasks.set(i, task);
          this.workers[i].postMessage({ id: task.id, data: task.data });
          return;
        }
      }

      this.queue.push(task);
    });
  }

  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.queue = [];
    this.activeTasks.clear();
  }

  get idleCount(): number {
    return this.workers.length - this.activeTasks.size;
  }
}
