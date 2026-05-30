import type { RaceType, NPCCharacter, EmotionVectorData, DialogueAnchor } from '@/types';

export class NPC {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly race: RaceType,
    public readonly character: NPCCharacter,
    public readonly emotionBaseline: EmotionVectorData,
    public readonly anchors: DialogueAnchor[],
    public readonly requiredReputation: number,
  ) {}
}
