import { describe, it, expect, vi, afterEach } from "vitest";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { resetSeen } from "@/systems/onboarding/onboardingState";

vi.mock("@/systems/onboarding/onboardingState", () => ({
  resetSeen: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function makeScene() {
  const scene = new MainMenuScene({} as never) as unknown as {
    handleReplayOnboarding: () => void;
    showMessage: (m: string, c?: number) => void;
  };
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
