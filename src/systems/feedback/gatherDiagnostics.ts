// Builds the full beta-feedback context (five core fields + a rich `extras`
// block) for the always-on global «Оставить issue» button. Kept out of
// `feedbackLink.ts` so that module stays a pure URL composer; this one reads the
// live game + browser. Decoupled from GameEngine via a structural source type,
// and the browser read is injectable so it unit-tests under jsdom or bare Node.

import { buildInfo } from "./buildInfo";
import type { FeedbackContext } from "./feedbackLink";

/**
 * The live game fields a diagnostics snapshot reads. Structural (not the
 * GameEngine class) so this module carries no engine dependency — `GameEngine`
 * satisfies it by shape.
 */
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

/** Browser/runtime facts useful for triaging a report. */
export interface RuntimeInfo {
  readonly viewport: string;
  readonly dpr: number;
  readonly userAgent: string;
  readonly url: string;
  readonly language: string;
  readonly online: boolean;
  readonly timestamp: string;
}

/**
 * Read {@link RuntimeInfo} from the browser, every access `typeof`-guarded so a
 * non-DOM runtime (unit tests without jsdom) yields stable placeholders rather
 * than a ReferenceError.
 */
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

/**
 * Compose the full {@link FeedbackContext} — five core fields plus an `extras`
 * block (player, economy, location, viewport, device, network, build URL, user
 * agent, timestamp) — from the live game and browser. Pure given its inputs:
 * inject `runtime` in tests to assert a deterministic snapshot.
 */
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
