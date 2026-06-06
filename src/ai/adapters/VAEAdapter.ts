import type { ONNXModelRegistry } from "../ONNXModelRegistry";
import type { FallbackEngine } from "../FallbackEngine";
import { logger } from "@/utils/logger";

declare const __DEBUG__: boolean;

export class VAEAdapter implements FallbackEngine<number[], number[]> {
  readonly name = "VAEAdapter";

  constructor(_registry: ONNXModelRegistry) {
    if (typeof __DEBUG__ === "undefined" || !__DEBUG__) {
      logger.warn(
        "VAEAdapter: stub implementation in use — no real ONNX model loaded",
      );
    }
  }

  async process(input: number[]): Promise<number[]> {
    return input.map((v) => v + Math.random() * 0.1);
  }
}
