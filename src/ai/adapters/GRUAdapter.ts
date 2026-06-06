import type { ONNXModelRegistry } from "../ONNXModelRegistry";
import type { FallbackEngine } from "../FallbackEngine";
import type { EmotionVectorData } from "@/types";
import { logger } from "@/utils/logger";

declare const __DEBUG__: boolean;

export class GRUAdapter implements FallbackEngine<
  { context: unknown; history: unknown[] },
  EmotionVectorData
> {
  readonly name = "GRUAdapter";

  constructor(_registry: ONNXModelRegistry) {
    if (typeof __DEBUG__ === "undefined" || !__DEBUG__) {
      logger.warn(
        "GRUAdapter: stub implementation in use — no real ONNX model loaded",
      );
    }
  }

  async process(_input: {
    context: unknown;
    history: unknown[];
  }): Promise<EmotionVectorData> {
    return {
      trust: 0,
      fear: 0,
      respect: 0,
      hostility: 0,
      curiosity: 0,
    };
  }
}
