# Story Decomposition: PWA Service Worker with WASM/ONNX Caching

## INVEST Analysis

### Abstract Task

**"Progressive Web App Service Worker for Offline Play and Heavy Asset Caching"**

**Analysis Dimensions**:
- **Core Responsibility**: Make the game installable as a PWA and fully playable offline after the first load by caching static assets, WASM binaries, and ONNX models via a Service Worker.
- **Primary Operations**: Register Service Worker, implement cache-first for static assets, implement stale-while-revalidate for WASM/ONNX, handle cache updates on new versions, provide offline fallback.
- **Key Constraints**: ONNX models can be 15 MB+; total cache budget must be managed; cache invalidation must be reliable across deployments.
- **Technical Complexity**: Medium — Service Worker APIs are standard, but cache strategies for multi-megabyte binary files require careful handling.
- **Business Complexity**: Low — clear offline-play requirement from GDD; no ambiguous business rules.

### INVEST Evaluation

- ✅ **Independent**: Can be developed in parallel with rendering and AI stories; only requires a build output to cache.
- ✅ **Negotiable**: Exact cache strategies, cache naming conventions, and fallback page design are open to team discussion.
- ✅ **Valuable**: Enables offline play, reduces load times on repeat visits, and allows desktop installation — all GDD requirements.
- ✅ **Estimable**: 2–4 days for a developer familiar with PWA patterns.
- ✅ **Small**: Three core functional points (SW registration and static caching, WASM/ONNX caching strategy, update handling).
- ✅ **Testable**: Offline mode, cache hits, and version updates can be verified in browser DevTools and automated test environments.

**Conclusion**: Ready as-is.

### Split Strategy

Not needed — the PWA infrastructure is a single coherent deliverable.

---

## [STORY-001-004] PWA Service Worker with WASM and ONNX Caching

### Background

The GDD explicitly targets PWA installation and full offline functionality: after the first load, the game must run without an internet connection. This is especially important because the AI models (WASM backend for onnxruntime-web and ONNX model files) are large binaries that must not be re-downloaded on every session. A Service Worker is the standard mechanism to achieve this. This story covers registration, intelligent caching strategies for different asset types, and graceful handling of updates so players always receive the latest game version when online, while still being able to play offline.

Key points:
- Phase 3 (Alpha) of the GDD lists "PWA and offline" as a requirement.
- WASM and ONNX files are the largest assets (~15–40 MB total); caching them is the highest-impact optimization.
- Cache invalidation must be reliable: a new deployment should update cached assets without leaving the player stuck on an old version.

### Business Value

- Allow players to launch and play the game without an internet connection after the first visit.
- Reduce subsequent load times by serving heavy AI models from local cache.
- Enable installation on desktop and mobile home screens as a first-class application experience.

### Dependencies and Assumptions

- **Prerequisites**: The project build process produces stable, versioned asset URLs (hash in filename or query string).
- **Data assumptions**: A PWA manifest file (`manifest.json`) exists or will be created as part of this story.
- **Integration points**: Build toolchain (Vite PWA plugin or custom SW build); deployment platform (Vercel/CDN) must serve the Service Worker with correct MIME type and scope.
- **Business constraints**: The game must not prompt for installation aggressively; offline fallback must be informative, not a blank screen.

### Scope In

- Register a Service Worker at application startup with scope covering the entire game.
- Implement **Cache-first** strategy for static assets (HTML, JS, CSS): serve from cache, fetch from network only on cache miss.
- Implement **Stale-while-revalidate** strategy for WASM and ONNX model files: serve from cache immediately, then silently update from network if a newer version exists.
- Implement cache cleanup: remove outdated caches when a new Service Worker activates.
- Provide an offline fallback page or in-game message when the app has never been cached and the device is offline.

### Scope Out

- Push notifications and background sync.
- Automatic app updates without user interaction (refresh prompt is acceptable, forced reload is not).
- Caching of user-generated data (save games) — this remains in IndexedDB.
- Advanced cache quota management UI (warning on excessive cache size is acceptable, manual eviction is not).

### Acceptance Criteria (ACs)

#### AC1: PWA Installation
**Given** the player uses a modern browser that supports PWA installation
**When** the player clicks "Install" from the browser's address bar or menu
**Then** the game installs as a standalone application with the correct icon, name "Космические рейнджеры: Нейросетевое вторжение", and launches without the browser address bar

#### AC2: Offline Launch After First Visit
**Given** the player has fully loaded the game at least once while online
**When** the device loses internet connectivity and the player reopens the game
**Then** the game loads entirely from Service Worker cache, all core functionality is available, and no network errors appear in the console

#### AC3: ONNX Model Caching
**Given** the dialogue ONNX model (15 MB) was downloaded from the CDN during the first session
**When** the player starts a new session
**Then** the model is served from the Service Worker cache, no repeated CDN download occurs, and the model loads within 500 ms

#### AC4: Cache Update on New Version
**Given** a new game version is deployed with updated JavaScript bundles
**When** the player opens the game
**Then** the new Service Worker installs in the background, updates the cache with new assets, and prompts the player with a non-blocking notification: "Доступно обновление. Перезагрузите страницу для применения."

#### AC5: Offline Fallback for First-Time Users
**Given** the game has never been loaded on the device
**When** the player attempts to open the game while offline
**Then** a fallback screen is displayed with the message: "Требуется подключение для первой загрузки игры. После загрузки вы сможете играть офлайн."

#### Non-Functional Expectations
- Service Worker registration must not block application startup for more than 500 ms.
- Total cache size for WASM and ONNX files should not exceed 100 MB without emitting a console warning.
- Cache updates must be atomic: the player must never encounter a half-updated cache (e.g., new JS with old WASM).
