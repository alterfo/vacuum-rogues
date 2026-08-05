import { buildInfo } from "./buildInfo";
import type { FeedbackContext } from "./feedbackLink";

export interface DiagnosticsSource {
  readonly currentSceneType: string;
  readonly galaxy:
    | {
        readonly gameDays: number;
        readonly id: string;
        readonly systems?: ReadonlyArray<unknown>;
      }
    | null
    | undefined;
  readonly player:
    | {
        readonly name: string;
        readonly rank: number;
        readonly credits: number;
        readonly currentSystemId: string;
      }
    | null
    | undefined;
}

export interface RuntimeInfo {
  readonly viewport: string;
  readonly dpr: number;
  readonly userAgent: string;
  readonly url: string;
  readonly language: string;
  readonly online: boolean;
  readonly timestamp: string;
}

export function readRuntimeInfo(): RuntimeInfo {
  const w = typeof window !== "undefined" ? window : undefined;
  const n = typeof navigator !== "undefined" ? navigator : undefined;
  return {
    viewport: w ? `${w.innerWidth}x${w.innerHeight}` : "—",
    dpr: w && typeof w.devicePixelRatio === "number" ? w.devicePixelRatio : 1,
    userAgent: n?.userAgent ?? "—",
    url: typeof location !== "undefined" ? location.href : "—",
    language: n?.language ?? "—",
    online: n ? n.onLine : true,
    timestamp: new Date().toISOString(),
  };
}

export function gatherDiagnostics(
  src: DiagnosticsSource,
  runtime: RuntimeInfo = readRuntimeInfo(),
): FeedbackContext {
  const { version, sha } = buildInfo();
  const g = src.galaxy ?? null;
  const p = src.player ?? null;
  const extras: ReadonlyArray<readonly [string, string]> = [
    ["systems", g?.systems ? String(g.systems.length) : "—"],
    ["player", p ? `${p.name} (rank ${p.rank})` : "—"],
    ["credits", p ? String(p.credits) : "—"],
    ["location", p?.currentSystemId || "—"],
    ["viewport", runtime.viewport],
    ["dpr", String(runtime.dpr)],
    ["online", String(runtime.online)],
    ["lang", runtime.language],
    ["url", runtime.url],
    ["ua", runtime.userAgent],
    ["time", runtime.timestamp],
  ];
  return {
    version,
    sha,
    scene: src.currentSceneType,
    day: g?.gameDays ?? 0,
    seed: g?.id ?? "—",
    extras,
  };
}
