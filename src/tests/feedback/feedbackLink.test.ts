import { describe, it, expect } from "vitest";
import {
  buildFeedbackUrl,
  formatDiagnostics,
  FEEDBACK_REPO_SLUG,
  FEEDBACK_TEMPLATE,
  FEEDBACK_TITLE_PREFIX,
  FEEDBACK_DIAGNOSTICS_FIELD,
  type FeedbackContext,
} from "@/systems/feedback/feedbackLink";

const baseCtx: FeedbackContext = {
  version: "0.1.0",
  sha: "a1b2c3d",
  scene: "SPACE_FLIGHT",
  day: 42,
  seed: "SR_12345",
};

describe("feedbackLink", () => {
  it("targets the correct repo new-issue base with the template param", () => {
    const url = new URL(buildFeedbackUrl(baseCtx));
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe(`/${FEEDBACK_REPO_SLUG}/issues/new`);
    expect(url.searchParams.get("template")).toBe(FEEDBACK_TEMPLATE);
    expect(url.searchParams.get("title")).toBe(FEEDBACK_TITLE_PREFIX);
  });

  it("prefills the diagnostics field carrying every context value", () => {
    const url = new URL(buildFeedbackUrl(baseCtx));
    const diag = url.searchParams.get(FEEDBACK_DIAGNOSTICS_FIELD);
    expect(diag).toBe(
      "version: 0.1.0\nsha: a1b2c3d\nscene: SPACE_FLIGHT\nday: 42\nseed: SR_12345",
    );
    // Every context value is present in the decoded diagnostics body.
    expect(diag).toContain("0.1.0");
    expect(diag).toContain("a1b2c3d");
    expect(diag).toContain("SPACE_FLIGHT");
    expect(diag).toContain("42");
    expect(diag).toContain("SR_12345");
  });

  it("uses the diagnostics field id that matches the Issue Form", () => {
    // Guards against drift from `.github/ISSUE_TEMPLATE/beta-feedback.yml`.
    expect(FEEDBACK_DIAGNOSTICS_FIELD).toBe("diagnostics");
    const raw = buildFeedbackUrl(baseCtx);
    expect(raw).toContain("&diagnostics=");
  });

  it("percent-encodes newlines, spaces and Cyrillic in the raw query string", () => {
    const raw = buildFeedbackUrl({
      version: "dev",
      sha: "dev",
      scene: "Главное меню",
      day: 0,
      seed: "семя 7",
    });
    // Newlines between diagnostics lines.
    expect(raw).toContain("%0A");
    // Space inside "семя 7" → %20 (not "+"), title "[Beta] " space too.
    expect(raw).toContain("%20");
    expect(raw).not.toContain("+");
    // Title brackets are encoded.
    expect(raw).toContain("title=%5BBeta%5D%20");
    // Cyrillic is UTF-8 percent-encoded; round-trips on decode.
    const url = new URL(raw);
    expect(url.searchParams.get("diagnostics")).toContain("Главное меню");
    expect(url.searchParams.get("diagnostics")).toContain("семя 7");
  });

  it("formatDiagnostics renders the stable multi-line shape", () => {
    expect(formatDiagnostics(baseCtx)).toBe(
      [
        "version: 0.1.0",
        "sha: a1b2c3d",
        "scene: SPACE_FLIGHT",
        "day: 42",
        "seed: SR_12345",
      ].join("\n"),
    );
  });
});
