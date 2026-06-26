/**
 * Pure Service-Worker cache-name builder.
 *
 * The SW caches the app shell + JS/CSS; if the cache **name** does not change
 * between builds, `activate`'s "delete everything that isn't the current name"
 * sweep keeps the old cache (its name still matches) and the SW keeps serving the
 * **stale bundle** — the exact symptom a playtester hit where a shipped combat fix
 * "didn't take" (`docs/plans/20260626-...` Task 1). The old SW read
 * `globalThis.__BUILD_VERSION__` (a *member* access, which Vite's `define` does NOT
 * substitute), so the version silently fell back to `'dev'` on every build and the
 * cache name was frozen.
 *
 * The name is therefore keyed on **both** the package version *and* the build SHA:
 * the SHA changes on every commit, so each deploy gets a fresh cache name and the
 * `activate` sweep purges the previous build's stale cache. This module is pure
 * (no `self`/`caches`/WebWorker refs) so the contract is unit-testable.
 */
export interface SwCacheNames {
  /** Cache for the app shell + JS/CSS/static assets. */
  readonly cache: string;
  /** Cache for large model/wasm blobs (stale-while-revalidate). */
  readonly modelCache: string;
}

/**
 * Build the per-deploy cache names from the build identity. `version`/`sha` are
 * the Vite `define` literals (`__BUILD_VERSION__` / `__BUILD_SHA__`); either may be
 * `'dev'` when unavailable. Same identity ⇒ same names (cache hit across reloads of
 * the same build); a changed version **or** SHA ⇒ new names (old cache purged).
 */
export function buildCacheNames(version: string, sha: string): SwCacheNames {
  const tag = `${version}-${sha}`;
  return {
    cache: `vacuum-rogues-v${tag}`,
    modelCache: `vacuum-rogues-models-v${tag}`,
  };
}
