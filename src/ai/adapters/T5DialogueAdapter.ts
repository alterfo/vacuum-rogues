import type { ONNXModelRegistry } from "../ONNXModelRegistry";
import type { FallbackEngine } from "../FallbackEngine";
import { logger } from "@/utils/logger";

declare const __DEBUG__: boolean;

export class T5DialogueAdapter implements FallbackEngine<string, string> {
  readonly name = "T5DialogueAdapter";

  constructor(_registry: ONNXModelRegistry) {
    if (typeof __DEBUG__ === "undefined" || !__DEBUG__) {
      logger.warn(
        "T5DialogueAdapter: stub implementation in use — no real ONNX model loaded",
      );
    }
  }

  async process(input: string): Promise<string> {
    return `T5: ${input}`;
  }
}
