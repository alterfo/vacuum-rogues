import { InferenceException } from './InferenceException';

export class InferenceTimeoutException extends InferenceException {
  constructor(modelId: string, timeoutMs: number) {
    super(
      'INFERENCE_TIMEOUT',
      `Inference for model ${modelId} exceeded ${timeoutMs}ms timeout.`,
      { modelId, timeoutMs },
    );
    this.name = 'InferenceTimeoutException';
  }
}
