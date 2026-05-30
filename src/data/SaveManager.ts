import type { SaveState } from '@/domain/SaveState';
import type { SaveSlotInfo } from '@/types';
import { IndexedDBAdapter } from './IndexedDBAdapter';
import { SaveStateSerializer } from './SaveStateSerializer';
import { MigrationPipeline } from './MigrationPipeline';
import { GameValidationException } from '@/exceptions/GameValidationException';
import { GameSystemException } from '@/exceptions/GameSystemException';
import { validateSaveState } from '@/validation/schemas';
import { logger } from '@/utils/logger';

const MAX_SLOTS = 10;

export class SaveManager {
  private db: IndexedDBAdapter;
  private serializer: SaveStateSerializer;
  public readonly currentVersion = MigrationPipeline.CURRENT_VERSION;

  constructor() {
    this.db = new IndexedDBAdapter();
    this.serializer = new SaveStateSerializer();
  }

  async write(slotId: string, state: SaveState): Promise<void> {
    if (!slotId || typeof slotId !== 'string') {
      throw new GameValidationException('INVALID_SLOT_ID', 'Save slot ID must be a non-empty string.');
    }

    const slots = await this.listSlots();
    if (slots.length >= MAX_SLOTS && !slots.find((s) => s.slotId === slotId)) {
      throw new GameValidationException(
        'SAVE_SLOTS_FULL',
        `Maximum ${MAX_SLOTS} save slots reached. Please overwrite an existing slot.`,
      );
    }

    state.version = this.currentVersion;
    state.timestamp = Date.now();

    const serialized = this.serializer.serialize(state);

    try {
      const store = await this.db.getStore('readwrite');
      await new Promise<void>((resolve, reject) => {
        const request = store.put({
          slotId,
          version: state.version,
          timestamp: state.timestamp,
          playerLevel: state.player.level,
          location: state.player.ship.name,
          payload: serialized,
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new GameSystemException('SAVE_WRITE_FAILED', `Failed to write save to slot ${slotId}.`));
      });
      logger.info(`Game saved to slot ${slotId}`);
    } catch (e) {
      throw new GameSystemException('SAVE_WRITE_FAILED', `Failed to write save to slot ${slotId}.`, { cause: e });
    }
  }

  async read(slotId: string): Promise<SaveState | null> {
    if (!slotId || typeof slotId !== 'string') {
      throw new GameValidationException('INVALID_SLOT_ID', 'Save slot ID must be a non-empty string.');
    }

    try {
      const store = await this.db.getStore('readonly');
      const result = await new Promise<{ payload: string; version: number } | undefined>((resolve, reject) => {
        const request = store.get(slotId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new GameSystemException('SAVE_READ_FAILED', `Failed to read save from slot ${slotId}.`));
      });

      if (!result) return null;

      const parsed = this.serializer.deserialize(result.payload) as SaveState;

      // Validate save state with Zod before migration
      try {
        validateSaveState(parsed);
        logger.info(`Save slot ${slotId} validated successfully`);
      } catch (error) {
        if (error instanceof Error) {
          // Map ZodError issues to Russian message
          const issuePath = 'issues' in error ? (error as { issues?: Array<{ path: string[] }> }).issues?.[0]?.path?.join('.') || 'unknown' : 'unknown';
          const mappedMessage = this.mapZodIssueToRussian(error);
          throw new GameValidationException(
            'SAVE_VALIDATION_FAILED',
            `Сохранение повреждено: ${issuePath} — ${mappedMessage}`,
            { issues: (error as { issues?: unknown }).issues },
          );
        }
        throw error;
      }

      if (parsed.version < this.currentVersion) {
        logger.info(`Migrating save slot ${slotId} from version ${parsed.version}`);
        MigrationPipeline.migrate(parsed);
      }

      return parsed;
    } catch (e) {
      if (e instanceof GameValidationException) {
        throw e;
      }
      logger.error(`Failed to read save slot ${slotId}:`, e);
      return null;
    }
  }

  private mapZodIssueToRussian(error: Error): string {
    // Map common Zod issues to Russian messages
    const message = error.message;
    if (message.includes('version')) return 'версия сохранения некорректна';
    if (message.includes('timestamp')) return 'временная метка некорректна';
    if (message.includes('galaxy')) return 'данные галактики повреждены';
    if (message.includes('player')) return 'данные игрока повреждены';
    if (message.includes('player.ship')) return 'данные корабля повреждены';
    if (message.includes('player.credits')) return 'количество кредитов некорректно';
    if (message.includes('hullHP')) return 'здоровье корпуса некорректно';
    return 'некорректная структура данных';
  }

  async listSlots(): Promise<SaveSlotInfo[]> {
    try {
      const store = await this.db.getStore('readonly');
      return new Promise<SaveSlotInfo[]>((resolve, reject) => {
        const request = store.openCursor();
        const slots: SaveSlotInfo[] = [];
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const value = cursor.value;
            slots.push({
              slotId: value.slotId,
              timestamp: value.timestamp,
              playerLevel: value.playerLevel,
              location: value.location,
            });
            cursor.continue();
          } else {
            resolve(slots);
          }
        };
        request.onerror = () => reject(new GameSystemException('SAVE_LIST_FAILED', 'Failed to list save slots.'));
      });
    } catch (e) {
      logger.error('Failed to list save slots:', e);
      return [];
    }
  }

  async deleteSlot(slotId: string): Promise<void> {
    try {
      const store = await this.db.getStore('readwrite');
      await new Promise<void>((resolve, reject) => {
        const request = store.delete(slotId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new GameSystemException('SAVE_DELETE_FAILED', `Failed to delete save slot ${slotId}.`));
      });
      logger.info(`Save slot ${slotId} deleted`);
    } catch (e) {
      logger.error(`Failed to delete save slot ${slotId}:`, e);
      throw e;
    }
  }

  async hasSave(): Promise<boolean> {
    const slots = await this.listSlots();
    return slots.length > 0;
  }
}
