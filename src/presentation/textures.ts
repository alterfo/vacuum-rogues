import { Assets, Texture } from "pixi.js";
import { textures as manifest, allTextures } from "@/assets/manifest";
import { logger } from "@/utils/logger";

const cache: Record<string, Texture> = {};
let loadPromise: Promise<void> | null = null;

const LAZY_PREFIXES = [
  "panoramas/",
  "surfaces/",
  "planet_maps/",
  "star_maps/",
  "stars/",
  "nebula/",
  "quest_art/",
  "overmind_mood/",
];

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

export function tex(key: string): Texture | undefined {
  return cache[key];
}

export function texUrl(key: string): string | undefined {
  return manifest[key];
}

export function panoramaUrl(key: string): string | undefined {
  return manifest[`panoramas/${key}`];
}

export function panoramaTex(key: string): Texture | undefined {
  return cache[`panoramas/${key}`];
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

export function pickVariantKey(
  category: string,
  prefix: string,
  seed: string,
): string | undefined {
  const wanted = `${category}/${prefix}`;
  const keys = allTextures(category)
    .filter((k) => k === wanted || k.startsWith(`${wanted}_`))
    .sort();
  if (keys.length === 0) return undefined;
  return keys[hash(seed) % keys.length];
}
