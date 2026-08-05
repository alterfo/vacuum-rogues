import type { ISaveService } from "@/core/ports/ISaveService";
import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";

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
      currentSceneType: state.currentSceneType,
    }));
  }

  setSave(slotId: string, state: SaveState): void {
    this.saves.set(slotId, state);
  }

  clear(): void {
    this.saves.clear();
  }
}
