import { type Page, expect } from '@playwright/test';


export interface TestPlayer {
  name: string;
  race: string;
  credits: number;
  ship: string;
}

export interface TestSaveGame {
  slot: number;
  timestamp: number;
  playerName: string;
  system: string;
}

export const testPlayers: Record<string, TestPlayer> = {
  default: {
    name: 'Captain',
    race: 'Human',
    credits: 1000,
    ship: 'Ranger-1',
  },
  custom: {
    name: 'Star Voyager',
    race: 'Human',
    credits: 1000,
    ship: 'Explorer-X',
  },
};

export const testSaves: Record<string, TestSaveGame> = {
  slot1: {
    slot: 1,
    timestamp: Date.now(),
    playerName: 'Captain',
    system: 'Sol',
  },
  slot2: {
    slot: 2,
    timestamp: Date.now(),
    playerName: 'Explorer',
    system: 'Alpha Centauri',
  },
};

export const generateUniquePlayer = (): TestPlayer => ({
  name: `Captain ${Date.now()}`,
  race: 'Human',
  credits: 1000,
  ship: `Ship-${Date.now()}`,
});

export async function checkIndexedDB(
  page: Page,
  dbName: string = 'sr_game_saves'
): Promise<{ exists: boolean; saveCount: number }> {
  return await page.evaluate(
    async (databaseName) => {
      return new Promise<{ exists: boolean; saveCount: number }>(
        (resolve) => {
          const request = indexedDB.open(databaseName, 1);
          request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('saves')) {
              resolve({ exists: false, saveCount: 0 });
              return;
            }
            const transaction = db.transaction('saves', 'readonly');
            const store = transaction.objectStore('saves');
            const countRequest = store.count();
            countRequest.onsuccess = () =>
              resolve({ exists: true, saveCount: countRequest.result });
            countRequest.onerror = () =>
              resolve({ exists: false, saveCount: 0 });
          };
          request.onerror = () =>
            resolve({ exists: false, saveCount: 0 });
        }
      );
    },
    dbName
  );
}

export async function saveGameToIndexedDB(
  page: Page,
  saveData: TestSaveGame
): Promise<void> {
  await page.evaluate(async (data) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('sr_game_saves', 1);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('saves')) {
          db.createObjectStore('saves', { keyPath: 'slot' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('saves', 'readwrite');
        const store = transaction.objectStore('saves');
        const putRequest = store.put(data);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject();
      };
      request.onerror = () => reject();
    });
  }, saveData);
}

export async function loadGameFromIndexedDB(
  page: Page,
  slot: number
): Promise<TestSaveGame | null> {
  return await page.evaluate(async (saveSlot) => {
    return new Promise<TestSaveGame | null>((resolve) => {
      const request = indexedDB.open('sr_game_saves', 1);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('saves')) {
          resolve(null);
          return;
        }
        const transaction = db.transaction('saves', 'readonly');
        const store = transaction.objectStore('saves');
        const getRequest = store.get(saveSlot);
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  }, slot);
}

export async function waitForConsoleMessage(
  page: Page,
  text: string,
  timeout = 5000
): Promise<boolean> {
  let found = false;
  const listener = (msg: { text: () => string }) => {
    if (msg.text().includes(text)) {
      found = true;
    }
  };
  page.on('console', listener);

  try {
    await page.waitForTimeout(timeout);
    return found;
  } finally {
    page.off('console', listener);
  }
}

export async function collectAllConsoleMessages(
  page: Page,
  duration = 3000
): Promise<string[]> {
  const messages: string[] = [];
  const listener = (msg: { text: () => string }) => {
    messages.push(msg.text());
  };
  page.on('console', listener);

  await page.waitForTimeout(duration);

  page.off('console', listener);
  return messages;
}

export async function checkOnnxModelLoading(
  page: Page,
  modelName: string
): Promise<boolean> {
  const messages = await collectAllConsoleMessages(page, 5000);
  return messages.some((msg) => msg.includes(modelName) && msg.includes('loaded'));
}

export async function expectNoJavaScriptErrors(
  page: Page,
  excludedPatterns: string[] = []
): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });

  await page.waitForTimeout(2000);

  const criticalErrors = errors.filter(
    (e) =>
      !excludedPatterns.some((pattern) => e.includes(pattern)) &&
      !e.includes('favicon')
  );

  expect(criticalErrors.length).toBe(0);
}
