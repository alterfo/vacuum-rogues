import type { ONNXModelRegistry } from '../ONNXModelRegistry';
import type { FallbackEngine } from '../FallbackEngine';
import type { EmotionVectorData } from '@/types';

export class GRUAdapter implements FallbackEngine<{ context: unknown; history: unknown[] }, EmotionVectorData> {
  readonly name = 'GRUAdapter';

  constructor(_registry: ONNXModelRegistry) {}

  async process(_input: { context: unknown; history: unknown[] }): Promise<EmotionVectorData> {
    return {
      trust: 0,
      fear: 0,
      respect: 0,
      hostility: 0,
      curiosity: 0,
    };
  }
}
