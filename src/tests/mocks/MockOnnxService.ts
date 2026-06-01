import type { IOnnxService } from "@/core/ports/IOnnxService";
import type { CacheInfo } from "@/types";
import type { Tensor } from "onnxruntime-web";

/**
 * Mock implementation of IOnnxService for testing.
 * Never performs real inference; returns predictable tensors.
 */
export class MockOnnxService implements IOnnxService {
  private loadedModels = new Set<string>();
  public inferCallCount = 0;
  public lastModelId?: string;

  async infer(modelId: string, input: Tensor): Promise<Tensor> {
    this.inferCallCount++;
    this.lastModelId = modelId;
    // Return input as-is (identity mock)
    return input;
  }

  isModelLoaded(modelId: string): boolean {
    return this.loadedModels.has(modelId);
  }

  unloadModel(modelId: string): void {
    this.loadedModels.delete(modelId);
  }

  cleanup(): void {
    this.loadedModels.clear();
  }

  getCacheStatus(): CacheInfo {
    return {
      cachedModels: Array.from(this.loadedModels),
      totalSizeBytes: 0,
    };
  }

  /** Test helper: mark a model as loaded. */
  loadModel(modelId: string): void {
    this.loadedModels.add(modelId);
  }
}
