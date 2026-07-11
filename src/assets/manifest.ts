/**
 * Auto-discovering asset manifest.
 *
 * Drop a file into `src/assets/<category>/<name>.<png|jpg|webp>` and it is
 * picked up automatically by its path key — **no code change needed**. The key
 * is the path under `src/assets/` without extension, e.g.
 *   src/assets/nebula/red_mid.png      → texture("nebula/red_mid")
 *   src/assets/planets/terrestrial_01.png → texture("planets/terrestrial_01")
 *
 * Naming convention (see docs/design/ASSET_PIPELINE.md + ART_PROMPTS.md):
 *   nebula/<palette>_<layer>      palette: red|blue|green|teal · layer: far|mid|near
 *   planets/<type>_<NN>           pre-lit cut-out disc (static)
 *   planet_maps/<type>_<NN>       equirectangular surface map (rotates in-engine);
 *                                 _04+ = Solar System Scope CC BY 4.0, _01–_03 = AI
 *   star_maps/<startype>_<NN>     equirectangular star-surface map (rotates in-engine)
 *   stars/<startype>_<NN>         red_dwarf|yellow|blue_giant|neutron|white_dwarf
 *   panoramas/<faction>_city ·    360° landing backdrops (faction city + wilderness
 *   panoramas/wilderness_<biome>  biome: desert|jungle|tundra) — lazy-loaded
 *   ships/<role>_<NN>             ranger|trader|pirate|patrol|overmind_<tier>
 *                                 (tier: small|medium|large|boss)
 *   ui/<name> · icons/<module>
 *
 * Loaded into PixiJS Textures at boot by {@link module:@/presentation/textures};
 * use `pickVariant(category, prefix, seedId)` to choose a stable variant.
 *
 * Audio lives in `public/audio/` (served as-is, not bundled). Reference by the
 * state-key convention via {@link musicUrl} — see docs/design/AUDIO_TRACKLIST.md.
 */

// Eagerly resolve every bundled asset URL under this folder. With no assets yet
// this is simply an empty map — safe to ship before art exists.
const modules = import.meta.glob("./**/*.{png,jpg,jpeg,webp}", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Map of `category/name` (no extension) → resolved, hashed asset URL. */
export const textures: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const key = path.replace(/^\.\//, "").replace(/\.(png|jpe?g|webp)$/i, "");
  textures[key] = url;
}

/** Resolve a texture URL by its convention key, or undefined if not present. */
export function texture(key: string): string | undefined {
  return textures[key];
}

/** All keys under a category, e.g. allTextures("planets") → ["planets/ice_01", …]. */
export function allTextures(category: string): string[] {
  const prefix = `${category}/`;
  return Object.keys(textures).filter((k) => k.startsWith(prefix));
}

/**
 * Music URL for a game-state key (see AUDIO_TRACKLIST.md). Files live in
 * `public/audio/mus_<key>.ogg` and are served at this path verbatim.
 */
export function musicUrl(stateKey: string): string {
  return `/audio/mus_${stateKey}.ogg`;
}
