export interface BuildInfo {
  readonly version: string;
  readonly sha: string;
}

function readVersion(): string {
  const v =
    typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : undefined;
  return typeof v === "string" && v.length > 0 ? v : "dev";
}

function readSha(): string {
  const v = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : undefined;
  return typeof v === "string" && v.length > 0 ? v : "dev";
}

export function buildInfo(): BuildInfo {
  return { version: readVersion(), sha: readSha() };
}

export function formatBuildLine(info: BuildInfo = buildInfo()): string {
  return `v${info.version} (${info.sha})`;
}
