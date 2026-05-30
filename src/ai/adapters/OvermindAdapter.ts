import type { ONNXModelRegistry } from '../ONNXModelRegistry';
import type { FallbackEngine } from '../FallbackEngine';
import type { OvermindAction } from '@/types';

export class OvermindAdapter implements FallbackEngine<unknown, OvermindAction> {
  readonly name = 'OvermindAdapter';

  constructor(_registry: ONNXModelRegistry) {}

  async process(_input: unknown): Promise<OvermindAction> {
    return {
      type: 'INVADE',
      targetSystemId: '',
    };
  }
}
