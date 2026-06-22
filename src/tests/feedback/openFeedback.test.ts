import { describe, it, expect, vi } from "vitest";
import { openFeedback } from "@/systems/feedback/openFeedback";
import {
  buildFeedbackUrl,
  type FeedbackContext,
} from "@/systems/feedback/feedbackLink";

const ctx: FeedbackContext = {
  version: "0.1.0",
  sha: "a1b2c3d",
  scene: "MAIN_MENU",
  day: 3,
  seed: "galaxy_SR_42",
};

describe("openFeedback", () => {
  it("hands the composed URL to the injected opener with new-tab + noopener", () => {
    const open = vi.fn();
    openFeedback(ctx, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      buildFeedbackUrl(ctx),
      "_blank",
      "noopener",
    );
  });
});
