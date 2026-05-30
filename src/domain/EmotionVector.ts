import type { EmotionVectorData } from '@/types';

export class EmotionVector implements EmotionVectorData {
  trust: number;
  fear: number;
  respect: number;
  hostility: number;
  curiosity: number;

  constructor(data: Partial<EmotionVectorData> = {}) {
    this.trust = data.trust ?? 0;
    this.fear = data.fear ?? 0;
    this.respect = data.respect ?? 0;
    this.hostility = data.hostility ?? 0;
    this.curiosity = data.curiosity ?? 0;
  }

  compute(_context: unknown, _history: unknown[]): EmotionVector {
    // Placeholder for GRU-driven computation
    return new EmotionVector({
      trust: this.clamp(this.trust + Math.random() * 10 - 5),
      fear: this.clamp(this.fear + Math.random() * 10 - 5),
      respect: this.clamp(this.respect + Math.random() * 10 - 5),
      hostility: this.clamp(this.hostility + Math.random() * 10 - 5),
      curiosity: this.clamp(this.curiosity + Math.random() * 10 - 5),
    });
  }

  private clamp(value: number): number {
    return Math.max(-100, Math.min(100, value));
  }

  toData(): EmotionVectorData {
    return {
      trust: this.trust,
      fear: this.fear,
      respect: this.respect,
      hostility: this.hostility,
      curiosity: this.curiosity,
    };
  }
}
