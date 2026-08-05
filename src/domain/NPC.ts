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
