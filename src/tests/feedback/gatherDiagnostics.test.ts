import { describe, it, expect } from "vitest";
import {
  gatherDiagnostics,
  readRuntimeInfo,
  type DiagnosticsSource,
  type RuntimeInfo,
} from "@/systems/feedback/gatherDiagnostics";
import {
  formatDiagnostics,
  buildFeedbackUrl,
} from "@/systems/feedback/feedbackLink";

const runtime: RuntimeInfo = {
  viewport: "1920x1080",
  dpr: 2,
  userAgent: "TestAgent/1.0",
  url: "https://alterfo.github.io/vacuum-rogues/",
  language: "ru-RU",
  online: true,
  timestamp: "2026-06-22T00:00:00.000Z",
};

const source: DiagnosticsSource = {
  currentSceneType: "SPACE_FLIGHT",
  galaxy: { gameDays: 42, id: "SR_999", systems: [{}, {}, {}] },
  player: {
    name: "Бродяга",
    rank: 3,
    credits: 12345,
    currentSystemId: "sys-7",
  },
};

function extrasMap(ctx: { extras?: ReadonlyArray<readonly [string, string]> }) {
  return Object.fromEntries((ctx.extras ?? []).map(([k, v]) => [k, v]));
}

describe("gatherDiagnostics", () => {
  it("captures the five core fields from the live game", () => {
    const ctx = gatherDiagnostics(source, runtime);
    expect(ctx.scene).toBe("SPACE_FLIGHT");
    expect(ctx.day).toBe(42);
    expect(ctx.seed).toBe("SR_999");
    expect(typeof ctx.version).toBe("string");
    expect(typeof ctx.sha).toBe("string");
  });

  it("attaches rich extras (player, economy, location, device, browser)", () => {
    const e = extrasMap(gatherDiagnostics(source, runtime));
    expect(e.systems).toBe("3");
    expect(e.player).toBe("Бродяга (rank 3)");
    expect(e.credits).toBe("12345");
    expect(e.location).toBe("sys-7");
    expect(e.viewport).toBe("1920x1080");
    expect(e.dpr).toBe("2");
    expect(e.online).toBe("true");
    expect(e.lang).toBe("ru-RU");
    expect(e.url).toBe("https://alterfo.github.io/vacuum-rogues/");
    expect(e.ua).toBe("TestAgent/1.0");
    expect(e.time).toBe("2026-06-22T00:00:00.000Z");
  });

  it("degrades gracefully with no galaxy/player (e.g. main menu)", () => {
    const ctx = gatherDiagnostics(
      { currentSceneType: "MAIN_MENU", galaxy: null, player: null },
      runtime,
    );
    expect(ctx.day).toBe(0);
    expect(ctx.seed).toBe("—");
    const e = extrasMap(ctx);
    expect(e.player).toBe("—");
    expect(e.credits).toBe("—");
    expect(e.location).toBe("—");
    expect(e.systems).toBe("—");
  });

  it("readRuntimeInfo returns a well-formed snapshot without throwing", () => {
    const info = readRuntimeInfo();
    expect(typeof info.viewport).toBe("string");
    expect(typeof info.userAgent).toBe("string");
    expect(typeof info.online).toBe("boolean");
    expect(info.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("formatDiagnostics + buildFeedbackUrl with extras", () => {
  it("appends extras after the five core lines, leaving the core shape intact", () => {
    const lines = formatDiagnostics({
      version: "0.1.0",
      sha: "abc1234",
      scene: "PLANET",
      day: 7,
      seed: "S",
      extras: [
        ["credits", "500"],
        ["viewport", "800x600"],
      ],
    }).split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "version: 0.1.0",
      "sha: abc1234",
      "scene: PLANET",
      "day: 7",
      "seed: S",
    ]);
    expect(lines.slice(5)).toEqual(["credits: 500", "viewport: 800x600"]);
  });

  it("carries the extras through the encoded issue URL", () => {
    const url = new URL(buildFeedbackUrl(gatherDiagnostics(source, runtime)));
    const diag = url.searchParams.get("diagnostics") ?? "";
    expect(diag).toContain("scene: SPACE_FLIGHT");
    expect(diag).toContain("player: Бродяга (rank 3)");
    expect(diag).toContain("ua: TestAgent/1.0");
  });
});
