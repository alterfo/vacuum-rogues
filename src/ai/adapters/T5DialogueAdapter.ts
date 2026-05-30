import type { ONNXModelRegistry } from '../ONNXModelRegistry';
import type { FallbackEngine } from '../FallbackEngine';

export class T5DialogueAdapter implements FallbackEngine<string, string> {
  readonly name = 'T5DialogueAdapter';

  constructor(_registry: ONNXModelRegistry) {}

  async process(input: string): Promise<string> {
    // Actual T5 inference would happen here via registry.infer
    return `T5: ${input}`;
  }
}
