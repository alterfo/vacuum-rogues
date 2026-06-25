/**
 * Onboarding replay (Task 6): the Main-Menu «Показать обучение заново» control
 * clears the browser-level "seen" help-hint set via `resetSeen()`, so every
 * screen's first-time auto-hint shows again on the next visit. We mock the
 * onboarding-state module so the test asserts the control invokes `resetSeen`
 * (the AC), and stub `showMessage` so the confirmation toast never touches the
 * renderer (the scene is built bare, like the feedback/new-game handler tests).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { resetSeen } from "@/systems/onboarding/onboardingState";

vi.mock("@/systems/onboarding/onboardingState", () => ({
  resetSeen: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

/** Bare scene; the replay handler only calls `resetSeen` + a stubbed message. */
function makeScene() {
  const scene = new MainMenuScene({} as never) as unknown as {
    handleReplayOnboarding: () => void;
    showMessage: (m: string, c?: number) => void;
  };
  // The confirmation toast reads `this.renderer.app.screen` — stub it out so the
  // unit stays off the render path (mirrors handleFeedback's renderer-free test).
  scene.showMessage = vi.fn();
  return scene;
}

describe("MainMenuScene — «Показать обучение заново»", () => {
  it("invokes resetSeen() so first-time hints replay", () => {
    const scene = makeScene();

    scene.handleReplayOnboarding();

    expect(resetSeen).toHaveBeenCalledTimes(1);
  });

  it("confirms the reset to the player", () => {
    const scene = makeScene();
    const showMessage = scene.showMessage as ReturnType<typeof vi.fn>;

    scene.handleReplayOnboarding();

    expect(showMessage).toHaveBeenCalledTimes(1);
    const [text] = showMessage.mock.calls[0] as [string];
    expect(text).toMatch(/обучен/i);
  });
});
