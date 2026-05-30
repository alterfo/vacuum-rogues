# Story Decomposition: ONNX Model Loading and IndexedDB Caching

## INVEST Analysis

### Abstract Task

**"ONNX Model Loading Infrastructure with CDN Fetch and IndexedDB Persistence"**

**Analysis Dimensions**:
- **Core Responsibility**: Provide the mechanism to download ONNX models from a CDN on first run, persist them to IndexedDB, and serve subsequent sessions from local storage.
- **Primary Operations**: Check IndexedDB for cached model, fetch from CDN on miss, store binary blob in IndexedDB, retrieve from IndexedDB on subsequent launches, handle version mismatches.
- **Key Constraints**: Models can be up to 15 MB (dialogue model); download must complete within 40 seconds on average connection; caching must survive browser restarts.
- **Technical Complexity**: Medium — IndexedDB API is verbose but well-documented; binary blob handling requires careful encoding.
- **Business Complexity**: Low — clear caching requirement; no ambiguous business rules.

### INVEST Evaluation

- ✅ **Independent**: Can be developed and tested without ONNX runtime or game logic; only requires a test model file.
- ✅ **Negotiable**: Cache versioning strategy, eviction policy, and exact error messages are open to discussion.
- ✅ **Valuable**: Enables fast subsequent launches and offline play; directly supports the GDD's PWA requirements.
- ✅ **Estimable**: 2–4 days for a developer familiar with IndexedDB and Promise-based APIs.
- ✅ **Small**: Two core functional points (initial CDN fetch + IndexedDB storage, subsequent local retrieval).
- ✅ **Testable**: Cache hits/misses, download timing, and persistence across restarts are verifiable.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — the model loading lifecycle is a single coherent deliverable.

---

## [STORY-001-006] ONNX Model Loading and IndexedDB Caching

### Background

The game's AI models (dialogue, tactical, content generator, emotional engine) are hosted on a CDN and can be up to 15 MB each. To meet the GDD's performance targets (≤40s initial download, ≤5s subsequent launch), models must be cached locally after the first download. Service Worker (covered in Story-4) handles static asset caching, but ONNX models are dynamic and may need versioned invalidation. This story implements a dedicated model-loading layer that checks IndexedDB first, falls back to CDN on miss, and persists the binary blob for future sessions.

Key points:
- This infrastructure is a prerequisite for all AI features (Phases 2–3).
- IndexedDB is chosen over localStorage because it supports large binary blobs.
- Versioning must be included to force re-download when models are updated on the CDN.

### Business Value

- Reduce subsequent load times from 40+ seconds to under 5 seconds.
- Enable offline play by serving models from local storage.
- Ensure players always receive updated models when the CDN version changes.

### Dependencies and Assumptions

- **Prerequisites**: ONNX model files are hosted on a CDN with versioned URLs; IndexedDB is available in the browser.
- **Data assumptions**: A model manifest (JSON file) lists model URLs, versions, and sizes.
- **Integration points**: The ONNX runtime (Story-2) will depend on this loader to provide model binaries.
- **Business constraints**: Model downloads must not block the main thread; progress feedback must be provided to the player.

### Scope In

- Implement an `ONNXModelLoader` that checks IndexedDB for a cached model before fetching from CDN.
- Fetch model binary from CDN and store as a `Blob` in IndexedDB with version metadata.
- Retrieve model binary from IndexedDB on subsequent launches without network requests.
- Handle cache invalidation: if CDN version > IndexedDB version, re-download and replace.
- Provide progress feedback (download percentage) to the UI during initial fetch.
- Implement error handling: network failures, IndexedDB quota exceeded, corrupted blobs.

### Scope Out

- ONNX model inference (covered in Story-2).
- Service Worker caching strategy (covered in Story-4; this story is application-level IndexedDB).
- Model compression or optimization.
- Parallel downloading of multiple models.

### Acceptance Criteria (ACs)

#### AC1: First-Time Download to IndexedDB
**Given** the player launches the game for the first time (no cached models in IndexedDB)
**When** the game attempts to load the dialogue model (15 MB) from the CDN
**Then** the model is downloaded, stored in IndexedDB with version metadata, and the download completes within 40 seconds on a 10 Mbps connection

#### AC2: Subsequent Load from IndexedDB
**Given** the dialogue model was previously downloaded and stored in IndexedDB
**When** the player launches the game again
**Then** the model is retrieved from IndexedDB without any network requests, and the model loads within 5 seconds

#### AC3: Version Mismatch Triggers Re-download
**Given** the CDN has model version 2.0, but IndexedDB has version 1.0
**When** the game checks for the model
**Then** the old version is deleted, the new version is downloaded from CDN, and the new version is stored in IndexedDB

#### AC4: Download Progress Feedback
**Given** a 15 MB model is being downloaded from CDN
**When** the download is in progress
**Then** the UI displays real-time progress (e.g., "Загрузка модели: 45% (6.75 MB / 15 MB)")

#### AC5: Network Failure Handling
**Given** the CDN is unreachable (network error or 404)
**When** the game attempts to download the model
**Then** the UI displays: "Не удалось загрузить ИИ-модель. Проверьте подключение и попробуйте снова." and the game falls back to a non-AI mode (templates only)

#### AC6: IndexedDB Quota Exceeded
**Given** the browser's IndexedDB quota is nearly full (less than 15 MB available)
**When** the game attempts to store the model
**Then** the UI displays: "Недостаточно места для кэша ИИ-моделей. Очистите историю браузера." and the game falls back to a non-AI mode

#### Non-Functional Expectations
- IndexedDB operations (read/write 15 MB blob) must complete in under 500 ms.
- Model loader must not block the main thread; progress updates must be smooth (≥30 FPS).
- Cache metadata must include: model name, version, download timestamp, file size.
