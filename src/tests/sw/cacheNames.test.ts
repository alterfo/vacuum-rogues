import { describe, it, expect } from "vitest";
import { buildCacheNames } from "@/systems/sw/cacheNames";

describe("buildCacheNames — per-build cache busting", () => {
  it("derives both cache names from the build identity", () => {
    const { cache, modelCache } = buildCacheNames("1.2.3", "abc1234");
    expect(cache).toBe("vacuum-rogues-v1.2.3-abc1234");
    expect(modelCache).toBe("vacuum-rogues-models-v1.2.3-abc1234");
  });

  it("is stable for the same build identity (cache hit across reloads)", () => {
    const a = buildCacheNames("1.0.0", "deadbee");
    const b = buildCacheNames("1.0.0", "deadbee");
    expect(a).toEqual(b);
  });

  it("changes the cache key when the build SHA changes (new commit ⇒ new cache)", () => {
    const before = buildCacheNames("1.0.0", "0000001");
    const after = buildCacheNames("1.0.0", "0000002");
    expect(after.cache).not.toBe(before.cache);
    expect(after.modelCache).not.toBe(before.modelCache);
  });

  it("changes the cache key when the package version changes", () => {
    const before = buildCacheNames("1.0.0", "abc1234");
    const after = buildCacheNames("1.1.0", "abc1234");
    expect(after.cache).not.toBe(before.cache);
    expect(after.modelCache).not.toBe(before.modelCache);
  });

  it("the app cache and the model cache are always distinct names", () => {
    const { cache, modelCache } = buildCacheNames("2.0.0", "feedface");
    expect(cache).not.toBe(modelCache);
  });
});
