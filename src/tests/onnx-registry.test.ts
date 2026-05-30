import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ONNXModelRegistry } from '@/ai/ONNXModelRegistry';
import { AdaptiveQualityProfile } from '@/ai/AdaptiveQualityProfile';

vi.mock('@/ai/WebWorkerPool', () => ({
  WebWorkerPool: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ data: [1, 2, 3], dims: [1, 3], type: 'float32', typedArrayName: 'Float32Array' }),
    terminate: vi.fn(),
    get idleCount() { return 4; }
  }))
}));

vi.mock('@/ai/IndexedDBCache', () => ({
  IndexedDBCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined)
  }))
}));

vi.mock('onnxruntime-web', () => ({
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      inputNames: ['input'],
      outputNames: ['output'],
      run: vi.fn().mockResolvedValue({
        output: {
          type: 'float32',
          data: new Float32Array([1, 2, 3]),
          dims: new Int32Array([1, 3])
        }
      }),
      dispose: vi.fn()
    })
  },
  Tensor: vi.fn().mockImplementation((type, data, dims) => ({
    type,
    data,
    dims
  }))
}));

describe('ONNXModelRegistry', () => {
  let registry: ONNXModelRegistry;
  let qualityProfile: AdaptiveQualityProfile;

  beforeEach(() => {
    vi.clearAllMocks();
    qualityProfile = new AdaptiveQualityProfile();
    registry = new ONNXModelRegistry(qualityProfile);
  });

  afterEach(() => {
    registry.cleanup();
    vi.resetAllMocks();
  });

  test('should initialize with worker pool', () => {
    expect(registry).toBeDefined();
  });

  test('should unload model correctly', () => {
    expect(() => registry.unloadModel('nonexistent')).not.toThrow();
  });

  test('should cleanup registry', () => {
    expect(() => registry.cleanup()).not.toThrow();
  });

  test('should return cache status', () => {
    const status = registry.getCacheStatus();
    expect(status).toHaveProperty('cachedModels');
    expect(status).toHaveProperty('totalSizeBytes');
  });
});
