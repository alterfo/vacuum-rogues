import type { InferenceSession, Tensor } from 'onnxruntime-web';

export class ONNXModel {
  constructor(
    public readonly modelId: string,
    public readonly version: string,
    public readonly session: InferenceSession,
  ) {}

  async run(inputs: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    return this.session.run(inputs);
  }

  dispose(): void {
    this.session.release();
  }
}
