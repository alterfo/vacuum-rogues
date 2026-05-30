import type { ONNXModelRegistry } from '../ONNXModelRegistry';
import type { FallbackEngine } from '../FallbackEngine';

export class VAEAdapter implements FallbackEngine<number[], number[]> {
  readonly name = 'VAEAdapter';

  constructor(_registry: ONNXModelRegistry) {}

  async process(input: number[]): Promise<number[]> {
    return input.map((v) => v + Math.random() * 0.1);
  }
}
