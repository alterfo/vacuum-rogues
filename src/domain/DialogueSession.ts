import type { EmotionVectorData, DialogueOption } from '@/types';
import type { NPC } from './NPC';
import type { Player } from './Player';

export interface Message {
  readonly sender: 'PLAYER' | 'NPC';
  readonly text: string;
  readonly timestamp: number;
}

export class DialogueSession {
  public readonly history: Message[] = [];
  public currentEmotion: EmotionVectorData;

  constructor(
    public readonly id: string,
    public readonly npc: NPC,
    public readonly player: Player,
    emotionBaseline: EmotionVectorData,
  ) {
    this.currentEmotion = { ...emotionBaseline };
  }

  sendPlayerMessage(text: string): void {
    this.history.push({
      sender: 'PLAYER',
      text,
      timestamp: Date.now(),
    });
  }

  addNPCResponse(text: string): void {
    this.history.push({
      sender: 'NPC',
      text,
      timestamp: Date.now(),
    });
  }

  generateOptions(): DialogueOption[] {
    return [];
  }
}
