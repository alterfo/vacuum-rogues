/**
 * Beta-feedback (Main Menu path): the «Сообщить отзыв» button captures the
 * menu-side context (scene = MAIN_MENU, plus the loaded run's day/seed when one
 * exists) and opens the prefilled GitHub Issue Form via the *default* opener.
 *
 * The in-flight path has its own URL assertion (inFlightMenuFeedback.test.ts);
 * this pins the Main-Menu branch, which reads `gameEngine.galaxy` directly and so
 * would otherwise drift silently (e.g. a `galaxy.id`/`gameDays` rename). Using the
 * default opener also exercises the real `openInNewTab` `typeof window` guard +
 * `window.open(url, "_blank", "noopener")` call that the unit opener tests stub.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { buildFeedbackUrl } from "@/systems/feedback/feedbackLink";
import { buildInfo } from "@/systems/feedback/buildInfo";
import { SceneType } from "@/types";
import type { GameEngine } from "@/systems/GameEngine";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Construct a bare scene (the feedback path never touches the renderer). */
function makeScene(galaxy: { gameDays: number; id: string } | null) {
  const scene = new MainMenuScene({} as never);
  (scene as unknown as { gameEngine: GameEngine | null }).gameEngine = galaxy
    ? ({ galaxy } as unknown as GameEngine)
    : null;
  return scene as unknown as { handleFeedback: () => void };
}

describe("MainMenuScene — «Сообщить отзыв»", () => {
  it("opens the prefilled Issue Form with the loaded run's day/seed", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    makeScene({ gameDays: 12, id: "galaxy_SR_42" }).handleFeedback();

    const { version, sha } = buildInfo();
    const expectedUrl = buildFeedbackUrl({
      version,
      sha,
      scene: SceneType.MAIN_MENU,
      day: 12,
      seed: "galaxy_SR_42",
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(expectedUrl, "_blank", "noopener");
  });

  it("falls back to day 0 / seed «—» when no run is loaded", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    makeScene(null).handleFeedback();

    expect(open).toHaveBeenCalledTimes(1);
    const [url] = open.mock.calls[0] as [string];
    const diag = new URL(url).searchParams.get("diagnostics") ?? "";
    expect(diag).toContain(`scene: ${SceneType.MAIN_MENU}`);
    expect(diag).toContain("day: 0");
    expect(diag).toContain("seed: —");
  });
});
