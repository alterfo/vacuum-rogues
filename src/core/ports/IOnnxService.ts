import type { Tensor } from "onnxruntime-web";
import type { CacheInfo } from "@/types";

/**
 * Port for ONNX model inference.
 * Follows DIP: GameEngine depends on abstraction, not ONNXModelRegistry.
 */
export interface IOnnxService {
  infer(modelId: string, input: Tensor): Promise<Tensor>;
  isModelLoaded(modelId: string): boolean;
  unloadModel(modelId: string): void;
  cleanup(): void;
  getCacheStatus(): CacheInfo;
}
