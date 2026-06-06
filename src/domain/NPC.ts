/**
 * Minimal NPC interface for dialogue system compatibility.
 * Full NPC domain was removed during rebrand to Вакуумные Пройдохи.
 * This stub allows dialogue-related files to compile.
 */
import { FactionType } from "@/types";

export interface NPC {
  readonly id: string;
  readonly name: string;
  readonly race?: FactionType;
  readonly emotionBaseline?: {
    trust: number;
    fear: number;
    respect: number;
    hostility: number;
    curiosity: number;
  };
}
