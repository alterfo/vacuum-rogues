import type { ONNXModelRegistry } from '../ONNXModelRegistry';
import type { FallbackEngine } from '../FallbackEngine';

export class PPOAdapter implements FallbackEngine<number[], number[]> {
  readonly name = 'PPOAdapter';

  constructor(_registry: ONNXModelRegistry) {}

  async process(input: number[]): Promise<number[]> {
    return input.map((v) => v * 0.5);
  }
}
