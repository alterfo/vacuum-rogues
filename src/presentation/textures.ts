/**
 * Presentation-layer texture cache.
 *
 * Bridges the pure {@link module:@/assets/manifest asset manifest} (URL keys
 * discovered by Vite glob) to live PixiJS {@link Texture} objects. Call
 * {@link preloadTextures} once at engine start; afterwards scenes/sprites look
 * textures up synchronously with {@link tex} / {@link pickVariant} and fall back
 * to procedural Graphics when a key is absent (e.g. art not generated yet, or in
 * unit tests where pixi is mocked and nothing is preloaded).
 */
import { Assets, Texture } from "pixi.js";
import { textures as manifest, allTextures } from "@/assets/manifest";
import { logger } from "@/utils/logger";

/** key (`category/name`) → loaded Texture. Empty until {@link preloadTextures}. */
const cache: Record<string, Texture> = {};
let loadPromise: Promise<void> | null = null;

/** Categories excluded from eager preload — loaded on demand instead. */
const LAZY_PREFIXES = ["panoramas/", "planet_maps/", "star_maps/"];

/**
 * Load every manifest asset into the texture cache, skipping large lazy
 * categories (panoramas, planet_maps, star_maps). Idempotent: repeated calls
 * return the same promise. Failures are logged but never reject (missing art
 * must not break boot).
 */
export function preloadTextures(): Promise<void> {
  if (loadPromise) return loadPromise;
  const entries = Object.entries(manifest).filter(
    ([key]) => !LAZY_PREFIXES.some((p) => key.startsWith(p)),
  );
  loadPromise = Promise.all(
    entries.map(async ([key, url]) => {
      try {
        cache[key] = await Assets.load(url);
      } catch (e) {
        logger.warn(`texture preload failed: ${key}`, e);
      }
    }),
  ).then(() => {
    logger.info(
      `Preloaded ${Object.keys(cache).length}/${entries.length} textures`,
    );
  });
  return loadPromise;
}

/**
 * Lazily load a single texture by manifest key. Returns cached Texture if
 * already loaded. Safe to call multiple times — deduplicates via cache.
 */
export async function loadTextureAsync(
  key: string,
): Promise<Texture | undefined> {
  if (cache[key]) return cache[key];
  const url = manifest[key];
  if (!url) return undefined;
  try {
    cache[key] = await Assets.load(url);
    return cache[key];
  } catch (e) {
    logger.warn(`lazy texture load failed: ${key}`, e);
    return undefined;
  }
}

/** Resolve a loaded texture by its exact manifest key, or undefined. */
export function tex(key: string): Texture | undefined {
  return cache[key];
}

/** Resolve the resolved asset URL for a manifest key, or undefined. Used for
 *  CSS cursors, which need a url() rather than a PixiJS Texture. */
export function texUrl(key: string): string | undefined {
  return manifest[key];
}

/**
 * Resolve a panorama asset URL for the given key (without the `panoramas/`
 * prefix), e.g. `panoramaUrl("terrestrial_01")` → hashed URL.
 * Returns undefined if the panorama is not in the manifest (art not yet
 * generated). Callers should fall back to a procedural background.
 */
export function panoramaUrl(key: string): string | undefined {
  return manifest[`panoramas/${key}`];
}

/**
 * Resolve a loaded panorama Texture for the given key. Returns undefined
 * when the asset is absent or not yet loaded. Use {@link loadTextureAsync}
 * with key `panoramas/<key>` to load on demand before calling this.
 */
export function panoramaTex(key: string): Texture | undefined {
  return cache[`panoramas/${key}`];
}

/** Tiny deterministic string hash (FNV-1a) for stable variant selection. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick one loaded texture deterministically from a category, restricted to keys
 * starting with `category/prefix` (the prefix selects the concept — e.g. a star
 * type or planet type — and `seed` selects which numbered variant of it).
 * Returns undefined when no matching texture is loaded.
 *
 *   pickVariant("planets", "ice", planet.id)  → planets/ice_02 (say)
 *   pickVariant("stars", "yellow", systemId)  → stars/yellow_01
 */
export function pickVariant(
  category: string,
  prefix: string,
  seed: string,
): Texture | undefined {
  const wanted = `${category}/${prefix}`;
  const keys = allTextures(category)
    .filter((k) => k === wanted || k.startsWith(`${wanted}_`))
    .filter((k) => cache[k])
    .sort();
  if (keys.length === 0) return undefined;
  return cache[keys[hash(seed) % keys.length]];
}
