# Story Decomposition: ONNX Runtime Web Inference in Web Workers

## INVEST Analysis

### Abstract Task

**"ONNX Runtime Web Inference Infrastructure with Worker-Based Execution"**

**Analysis Dimensions**:
- **Core Responsibility**: Enable non-blocking local AI inference by running onnxruntime-web inside Web Workers, with full tensor serialization between the main thread and workers.
- **Primary Operations**: Load ONNX models in a Worker, serialize input tensors from the main thread, execute inference, deserialize output tensors back to the main thread, handle errors and timeouts.
- **Key Constraints**: Must not block the UI thread; must support TypedArray-based tensor shapes and data types; must work with models up to 15 MB (per GDD).
- **Technical Complexity**: High — involves Web Worker lifecycle, postMessage serialization limits, onnxruntime-web API nuances, and tensor shape management.
- **Business Complexity**: Low — clear input/output contract; no ambiguous business rules.

### INVEST Evaluation

- ✅ **Independent**: Can be built and tested with a dummy ONNX model without any game logic or rendering.
- ✅ **Negotiable**: Exact worker pooling strategy, serialization format (structured clone vs. Transferable Objects), and timeout values are open to discussion.
- ✅ **Valuable**: Unlocks all AI-driven gameplay (dialogue, tactical AI, content generation) while preserving 60 FPS UI responsiveness.
- ✅ **Estimable**: Senior fullstack developer can estimate 3–5 days given onnxruntime-web documentation.
- ✅ **Small**: Three core functional points (Worker setup, tensor serialization, test inference execution).
- ✅ **Testable**: Inference outcomes and worker communication are verifiable with deterministic test models.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — the task forms a single cohesive infrastructure story.

---

## [STORY-001-002] ONNX Runtime Web Inference in Web Workers

### Background

The game's unique selling point is local neural network inference for dialogue generation, tactical AI, and dynamic content. The GDD specifies four ONNX models (dialogue ~15 MB, tactical AI ~3 MB, content generator ~5 MB, emotional engine ~1 MB). Executing these models on the main thread would freeze the UI, breaking the 60 FPS target. This story establishes the infrastructure to run onnxruntime-web inside dedicated Web Workers, ensuring the renderer and UI remain responsive. A critical requirement is full tensor serialization: tensors must be faithfully reconstructed inside the Worker with correct shape, data type, and memory layout.

Key points:
- All AI features (Phase 2 MVP) depend on this infrastructure.
- Worker-based execution is a non-functional requirement derived from the GDD's performance targets.
- Tensor serialization is the bridge between the game's JavaScript state and the ONNX runtime.

### Business Value

- Deliver local AI inference without requiring a server connection, ensuring privacy and offline play.
- Preserve a smooth user experience (60 FPS) during neural network execution.
- Provide the foundational AI engine upon which dialogue, tactical combat, and content generation features will be built.

### Dependencies and Assumptions

- **Prerequisites**: Build toolchain supports bundling for Web Workers; onnxruntime-web v1.17+ is installed.
- **Data assumptions**: A test ONNX model (e.g., a 1 MB micro-classifier or tiny GPT-2) is available for validation.
- **Integration points**: The main-thread game logic will communicate with the AI Worker via an abstraction layer (message bus or proxy).
- **Business constraints**: Inference must complete within 3 seconds for dialogue and within 100 ms for tactical decisions (per GDD); worker initialization must not exceed 1 second.

### Scope In

- Create an `AIWorker` that imports and initializes onnxruntime-web.
- Implement tensor serialization: convert JavaScript TypedArrays + shape metadata into transferable messages and reconstruct `ort.Tensor` inside the Worker.
- Implement tensor deserialization: convert Worker output tensors back to plain JavaScript objects/TypedArrays in the main thread.
- Execute inference on a test ONNX model end-to-end (main thread → Worker → inference → main thread).
- Implement error handling for model load failures, inference exceptions, and execution timeouts.

### Scope Out

- Training, fine-tuning, or quantization of models.
- Integration of the four specific game models (dialogue, tactical, generator, emotional) — only the inference infrastructure is in scope.
- IndexedDB caching strategy for model files (covered by the PWA / Service Worker story).
- Advanced optimizations such as WebGPU backend or graph optimizations.

### Acceptance Criteria (ACs)

#### AC1: End-to-End Worker Inference
**Given** a test ONNX model (≤1 MB) has been loaded into the AI Worker
**When** the main thread sends an inference request with valid input data
**Then** the Worker executes inference and returns the output to the main thread within 500 ms without causing frame drops in the UI

#### AC2: Tensor Serialization Integrity
**Given** an input tensor represented as a `Float32Array` of length 10 with shape `[1, 10]`
**When** the tensor is serialized, sent to the Worker, and reconstructed
**Then** the reconstructed tensor inside the Worker has identical data type (`float32`), identical shape `[1, 10]`, and bitwise-equal values

#### AC3: Model Load Failure Handling
**Given** the requested ONNX model URL is unreachable or returns 404
**When** the Worker attempts to load the model
**Then** the Worker catches the error, posts a descriptive failure message to the main thread, and the UI displays a user-facing notification: "Не удалось загрузить ИИ-модель. Проверьте подключение."

#### AC4: Inference Timeout
**Given** an inference request is configured with a 5-second timeout
**When** the model execution exceeds 5 seconds
**Then** the operation is aborted, the Worker returns a timeout error to the main thread, and the UI remains fully interactive

#### Non-Functional Expectations
- Inference of the test model in the Worker must complete in under 500 ms on a mid-tier device (Intel Core i5 8th gen equivalent).
- Tensor transfer (serialization + postMessage + deserialization) for tensors up to 10 MB must take less than 50 ms.
- Worker initialization overhead must not exceed 1 second.
