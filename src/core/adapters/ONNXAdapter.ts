import type { IOnnxService } from "@/core/ports/IOnnxService";
import type { CacheInfo } from "@/types";
import { ONNXModelRegistry } from "@/ai/ONNXModelRegistry";
import { AdaptiveQualityProfile } from "@/ai/AdaptiveQualityProfile";
import type { Tensor } from "onnxruntime-web";

/**
 * Adapter: makes ONNXModelRegistry compatible with IOnnxService port.
 * Follows Adapter pattern + DIP.
 */
export class ONNXAdapter implements IOnnxService {
  private readonly delegate: ONNXModelRegistry;

  constructor(qualityProfile?: AdaptiveQualityProfile) {
    this.delegate = new ONNXModelRegistry(
      qualityProfile ?? new AdaptiveQualityProfile(),
    );
  }

  infer(modelId: string, input: Tensor): Promise<Tensor> {
    return this.delegate.infer(modelId, input);
  }

  isModelLoaded(modelId: string): boolean {
    return this.delegate["models"].has(modelId);
  }

  unloadModel(modelId: string): void {
    this.delegate.unloadModel(modelId);
  }

  cleanup(): void {
    this.delegate.cleanup();
  }

  getCacheStatus(): CacheInfo {
    return this.delegate.getCacheStatus();
  }
}
