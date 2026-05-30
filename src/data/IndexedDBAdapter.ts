import { GameSystemException } from '@/exceptions/GameSystemException';

const DB_NAME = 'SpaceRangersSaves';
const DB_VERSION = 1;
const SAVES_STORE = 'saves';

export class IndexedDBAdapter {
  private db: IDBDatabase | null = null;

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        reject(new GameSystemException('INDEXEDDB_UNAVAILABLE', 'IndexedDB is not available. Saves will be temporary.'));
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains(SAVES_STORE)) {
          database.createObjectStore(SAVES_STORE, { keyPath: 'slotId' });
        }
      };
    });
  }

  async getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    const tx = db.transaction(SAVES_STORE, mode);
    return tx.objectStore(SAVES_STORE);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.open();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
