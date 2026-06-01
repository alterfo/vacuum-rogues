import type { SaveState } from "@/domain/SaveState";
import type { SaveSlotInfo } from "@/types";

/**
 * Port for game save persistence.
 * Follows DIP: GameEngine depends on this abstraction, not concrete SaveManager.
 */
export interface ISaveService {
  read(slotId: string): Promise<SaveState | null>;
  write(slotId: string, state: SaveState): Promise<void>;
  hasSave(): Promise<boolean>;
  deleteSlot(slotId: string): Promise<void>;
  listSlots(): Promise<SaveSlotInfo[]>;
}
