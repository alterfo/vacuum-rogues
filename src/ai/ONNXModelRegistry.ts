import { InferenceSession, Tensor } from "onnxruntime-web";
import type { ModelConfig, CacheInfo } from "@/types";
import { ONNXModel } from "./ONNXModel";
import { WebWorkerPool } from "./WebWorkerPool";
import { IndexedDBCache } from "./IndexedDBCache";
import { AdaptiveQualityProfile } from "./AdaptiveQualityProfile";
import { MODEL_MANIFEST } from "./ModelManifest";
import { InferenceTimeoutException } from "@/exceptions/InferenceTimeoutException";
import { GameSystemException } from "@/exceptions/GameSystemException";
import { logger } from "@/utils/logger";
import { SimpleONNXModel } from "./SimpleONNXModel";
import workerUrl from "./inference.worker.ts?url";

const INFERENCE_TIMEOUTS: Record<string, number> = {
  t5_dialogue: 3000,
  ppo_tactical: 100,
  vae_content: 2000,
  gru_emotion: 500,
  overmind_rl: 500,
};

export class ONNXModelRegistry {
  private models = new Map<string, ONNXModel>();
  private modelBuffers = new Map<string, ArrayBuffer>();
  private workerPool: WebWorkerPool;
  private indexedDB: IndexedDBCache;

  constructor(_qualityProfile: AdaptiveQualityProfile) {
    this.workerPool = new WebWorkerPool(workerUrl, 4);
    this.indexedDB = new IndexedDBCache();
  }

  async loadModel(modelId: string, config?: ModelConfig): Promise<ONNXModel> {
    if (this.models.has(modelId)) {
      return this.models.get(modelId)!;
    }

    const modelConfig = config ?? MODEL_MANIFEST[modelId];
    if (!modelConfig) {
      throw new GameSystemException(
        "MODEL_NOT_FOUND",
        `Model ${modelId} not found in manifest.`,
      );
    }

    // Check IndexedDB cache
    let buffer: ArrayBuffer | null = null;
    try {
      buffer = await this.indexedDB.get(`${modelId}@${modelConfig.version}`);
    } catch (e) {
      logger.warn(`Cache read failed for ${modelId}:`, e);
    }

    if (!buffer) {
      // Fetch from CDN
      logger.info(`Fetching model ${modelId} from CDN...`);
      try {
        const response = await fetch(modelConfig.url);
        if (!response.ok) {
          throw new GameSystemException(
            "MODEL_FETCH_FAILED",
            `Failed to fetch model ${modelId}: ${response.status}`,
          );
        }
        buffer = await response.arrayBuffer();

        // Cache to IndexedDB
        try {
          await this.indexedDB.set(
            `${modelId}@${modelConfig.version}`,
            buffer,
            modelConfig,
          );
        } catch (e) {
          logger.warn(`Cache write failed for ${modelId}:`, e);
        }
      } catch (fetchError) {
        logger.warn(
          `Model fetch failed, using mock session for POC:`,
          fetchError,
        );
        // For POC, create a mock session without requiring actual model file
        const mockSession = await SimpleONNXModel.createMockSession();
        const model = new ONNXModel(
          modelId,
          modelConfig.version,
          mockSession as unknown as InferenceSession,
        );
        this.models.set(modelId, model);
        logger.info(`Mock session created for ${modelId} (POC mode)`);
        return model;
      }
    }

    // Create inference session with real model buffer
    const session = await InferenceSession.create(buffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    const model = new ONNXModel(modelId, modelConfig.version, session);
    this.models.set(modelId, model);
    this.modelBuffers.set(modelId, buffer);
    logger.info(`Model ${modelId} loaded successfully.`);
    return model;
  }

  async infer(modelId: string, input: Tensor): Promise<Tensor> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new GameSystemException(
        "MODEL_NOT_LOADED",
        `Model ${modelId} is not loaded.`,
      );
    }

    const timeoutMs = INFERENCE_TIMEOUTS[modelId] ?? 1000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new InferenceTimeoutException(modelId, timeoutMs));
      }, timeoutMs);

      // Check if this is a mock session (POC mode)
      const buffer = this.modelBuffers.get(modelId);
      if (!buffer) {
        // Mock session - run inference directly without worker
        clearTimeout(timer);
        try {
          const outputTensor = new Tensor(input.type, input.data, input.dims);
          resolve(outputTensor);
        } catch (err) {
          reject(err);
        }
        return;
      }

      let typedArrayName = "Float32Array";
      let dataArray: number[];

      if (input.type === "float32") {
        typedArrayName = "Float32Array";
        dataArray = Array.from(input.data as Float32Array);
      } else if (input.type === "int32") {
        typedArrayName = "Int32Array";
        dataArray = Array.from(input.data as Int32Array);
      } else if (input.type === "uint8") {
        typedArrayName = "Uint8Array";
        dataArray = Array.from(input.data as Uint8Array);
      } else {
        typedArrayName = "Float32Array";
        dataArray = Array.from(input.data as Float32Array);
      }

      const payload: Record<string, unknown> = {
        modelId,
        input: {
          data: dataArray,
          dims: Array.from(input.dims),
          type: input.type,
          typedArrayName,
        },
      };

      this.workerPool
        .execute(payload)
        .then((result) => {
          clearTimeout(timer);
          const r = result as {
            data: number[];
            dims: number[];
            type: Tensor.Type;
            typedArrayName: string;
          };
          const reconstructedArray = this.reconstructTypedArray(
            r.data,
            r.typedArrayName,
          );
          resolve(new Tensor(r.type, reconstructedArray, r.dims));
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private reconstructTypedArray(
    data: number[],
    typeName: string,
  ): Float32Array | Int32Array | Uint8Array {
    switch (typeName) {
      case "Int32Array":
        return new Int32Array(data);
      case "Uint8Array":
        return new Uint8Array(data);
      case "Float32Array":
      default:
        return new Float32Array(data);
    }
  }

  unloadModel(modelId: string): void {
    const model = this.models.get(modelId);
    if (model) {
      model.dispose();
      this.models.delete(modelId);
      logger.info(`Model ${modelId} unloaded.`);
    }
  }

  cleanup(): void {
    for (const [modelId] of this.models) {
      this.unloadModel(modelId);
    }
    // Terminate idle workers beyond minimum pool size would be handled by WebWorkerPool
    logger.info("ONNXModelRegistry cleanup complete.");
  }

  getCacheStatus(): CacheInfo {
    const cachedModels: string[] = [];
    let totalSizeBytes = 0;
    for (const [modelId, config] of Object.entries(MODEL_MANIFEST)) {
      cachedModels.push(modelId);
      totalSizeBytes += config.sizeBytes;
    }
    return { cachedModels, totalSizeBytes };
  }
}
