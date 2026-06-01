import type { ISaveService } from "@/core/ports/ISaveService";
import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";

/**
 * Mock implementation of ISaveService for testing.
 * Follows LSP: behaves like real SaveManager but stores data in-memory.
 */
export class MockSaveService implements ISaveService {
  private readonly saves = new Map<string, SaveState>();

  async read(slotId: string): Promise<SaveState | null> {
    return this.saves.get(slotId) ?? null;
  }

  async write(slotId: string, state: SaveState): Promise<void> {
    this.saves.set(slotId, state);
  }

  async hasSave(): Promise<boolean> {
    return this.saves.size > 0;
  }

  async deleteSlot(slotId: string): Promise<void> {
    this.saves.delete(slotId);
  }

  async listSlots(): Promise<SaveSlotInfo[]> {
    return Array.from(this.saves.entries()).map(([slotId, state]) => ({
      slotId,
      timestamp: state.timestamp,
      playerLevel: state.player.level,
      location: state.player.ship.name,
    }));
  }

  /** Test helper: inject a save directly. */
  setSave(slotId: string, state: SaveState): void {
    this.saves.set(slotId, state);
  }

  /** Test helper: clear all saves. */
  clear(): void {
    this.saves.clear();
  }
}
