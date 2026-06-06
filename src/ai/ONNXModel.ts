import type { InferenceSession, Tensor } from "onnxruntime-web";

export class ONNXModel {
  constructor(
    public readonly modelId: string,
    public readonly version: string,
    public readonly session: InferenceSession | null,
  ) {}

  async run(inputs: Record<string, Tensor>): Promise<Record<string, Tensor>> {
    if (!this.session) {
      throw new Error(
        `ONNXModel(${this.modelId}): session runs in worker — call Registry.infer() instead`,
      );
    }
    return this.session.run(inputs);
  }

  dispose(): void {
    this.session?.release();
  }
}
