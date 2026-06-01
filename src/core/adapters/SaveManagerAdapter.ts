import type { ISaveService } from "@/core/ports/ISaveService";
import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";
import { SaveManager } from "@/data/SaveManager";

/**
 * Adapter: makes SaveManager compatible with ISaveService port.
 * Follows Adapter pattern + DIP.
 */
export class SaveManagerAdapter implements ISaveService {
  private readonly delegate = new SaveManager();

  read(slotId: string): Promise<SaveState | null> {
    return this.delegate.read(slotId);
  }

  write(slotId: string, state: SaveState): Promise<void> {
    return this.delegate.write(slotId, state);
  }

  hasSave(): Promise<boolean> {
    return this.delegate.hasSave();
  }

  deleteSlot(slotId: string): Promise<void> {
    return this.delegate.deleteSlot(slotId);
  }

  listSlots(): Promise<SaveSlotInfo[]> {
    return this.delegate.listSlots();
  }
}
