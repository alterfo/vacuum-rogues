export interface SwCacheNames {
  readonly cache: string;
  readonly modelCache: string;
}

export function buildCacheNames(version: string, sha: string): SwCacheNames {
  const tag = `${version}-${sha}`;
  return {
    cache: `vacuum-rogues-v${tag}`,
    modelCache: `vacuum-rogues-models-v${tag}`,
  };
}
