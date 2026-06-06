import { InferenceSession, Tensor } from "onnxruntime-web";

// Web Worker for ONNX inference
// Receives model buffer and input tensors, returns output tensors

interface WorkerInputTensor {
  data: number[];
  dims: number[];
  type: string;
  typedArrayName: string;
}

interface WorkerMessage {
  id: string;
  data: {
    modelBuffer?: ArrayBuffer;
    modelId?: string;
    input?: WorkerInputTensor;
  };
}

interface WorkerResponse {
  id: string;
  result?: {
    data: number[];
    dims: number[];
    type: string;
    typedArrayName: string;
  };
  error?: string;
}

const sessions = new Map<string, InferenceSession>();

function reconstructTypedArray(
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

function serializeTensor(tensor: Tensor): {
  data: number[];
  dims: number[];
  type: string;
  typedArrayName: string;
} {
  let typedArrayName = "Float32Array";
  if (tensor.type === "int32") {
    typedArrayName = "Int32Array";
  } else if (tensor.type === "uint8") {
    typedArrayName = "Uint8Array";
  }

  return {
    data: Array.from(
      tensor.data as unknown as Float32Array | Int32Array | Uint8Array,
    ),
    dims: Array.from(tensor.dims),
    type: tensor.type,
    typedArrayName,
  };
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, data } = event.data;

  try {
    // Load model into worker session cache when buffer is provided.
    if (data.modelBuffer && data.modelId) {
      const session = await InferenceSession.create(data.modelBuffer, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      sessions.set(data.modelId, session);

      // Load-only message (no input tensor) — respond with success and return.
      if (!data.input) {
        const resp: WorkerResponse = { id };
        self.postMessage(resp);
        return;
      }
    }

    let session: InferenceSession | undefined;
    if (data.modelId) {
      session = sessions.get(data.modelId);
    }

    if (!session) {
      throw new Error(
        "INFERENCE_NO_SESSION: No session available for inference",
      );
    }

    if (!data.input) {
      throw new Error(
        "INFERENCE_NO_INPUT: input tensor is required for inference",
      );
    }

    // Reconstruct Tensor from serialized data with preserved type
    const typedArray = reconstructTypedArray(
      data.input.data,
      data.input.typedArrayName,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputTensor = new Tensor(
      data.input.type as any,
      typedArray,
      data.input.dims,
    );
    const feeds: Record<string, Tensor> = {};
    feeds[session.inputNames[0] ?? "input"] = inputTensor;

    const results = await session.run(feeds);
    const outputName = session.outputNames[0] ?? "output";
    const output = results[outputName];

    const response: WorkerResponse = {
      id,
      result: serializeTensor(output),
    };

    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      error: error instanceof Error ? error.message : "Unknown inference error",
    };
    self.postMessage(response);
  }
};
