import type { ModelConfig } from '@/types';
import { GameSystemException } from '@/exceptions/GameSystemException';

const DB_NAME = 'SpaceRangersCache';
const DB_VERSION = 1;
const STORE_NAME = 'models';

export class IndexedDBCache {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(new GameSystemException('INDEXEDDB_OPEN_FAILED', 'Failed to open IndexedDB cache.'));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'modelId' });
        }
      };
    });
  }

  async get(modelId: string): Promise<ArrayBuffer | null> {
    if (!this.db) await this.open();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(modelId);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
      request.onerror = () => reject(new GameSystemException('INDEXEDDB_READ_FAILED', `Failed to read model ${modelId} from cache.`));
    });
  }

  async set(modelId: string, data: ArrayBuffer, config: ModelConfig): Promise<void> {
    if (!this.db) await this.open();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put({
        modelId,
        version: config.version,
        data,
        timestamp: Date.now(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new GameSystemException('INDEXEDDB_WRITE_FAILED', `Failed to write model ${modelId} to cache.`));
    });
  }

  async has(modelId: string): Promise<boolean> {
    const data = await this.get(modelId);
    return data !== null;
  }

  async purgeObsolete(validModelIds: string[]): Promise<void> {
    if (!this.db) await this.open();
    if (!this.db) return;

    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (!validModelIds.includes(cursor.value.modelId)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(new GameSystemException('INDEXEDDB_PURGE_FAILED', 'Failed to purge obsolete models.'));
    });
  }
}
