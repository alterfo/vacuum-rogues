import { describe, it, expect, afterEach, vi } from "vitest";
import { RealEngineHarness } from "./realEngineHarness";
import { MockSaveService } from "@/tests/mocks";
import { attachDevAutopilot } from "@/dev/devAutopilot";
import {
  installAutopilotHook,
  type AutopilotWindowHook,
} from "@/tests/playtest/letsplay/installAutopilotHook";
import type { AutopilotScheduler } from "@/tests/playtest/letsplay/AutopilotController";
import type { GameEngine } from "@/systems/GameEngine";
import type { IAutopilotStateProvider } from "@/core/ports/IAutopilotStateProvider";

vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

const inertScheduler: AutopilotScheduler = { start: () => () => {} };

const quietDeps = {
  scheduler: inertScheduler,
  onHumanInput: () => () => {},
  indicator: { show() {}, hide() {} },
};

function clearWindowHook(): void {
  delete (window as unknown as { __autopilot?: AutopilotWindowHook })
    .__autopilot;
}

function windowHook(): AutopilotWindowHook {
  const hook = (window as unknown as { __autopilot?: AutopilotWindowHook })
    .__autopilot;
  if (!hook) throw new Error("expected window.__autopilot to be installed");
  return hook;
}

function providerFor(hook: AutopilotWindowHook): IAutopilotStateProvider {
  return {
    isEngaged: () => hook.engaged,
    resume: (engaged: boolean) => {
      if (engaged) hook.start();
    },
  };
}

const quietLoader = () =>
  Promise.resolve({
    installAutopilotHook: (engine: GameEngine) =>
      installAutopilotHook(engine, quietDeps),
  });

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("Autopilot resumes from an autosave on reload (real engine)", () => {
  let harness: RealEngineHarness | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    clearWindowHook();
  });

  async function writeEngagedAutosave(
    store: MockSaveService,
    engaged: boolean,
  ): Promise<void> {
    const writer = await RealEngineHarness.boot({ saveService: store });
    await writer.newGame();
    clearWindowHook();
    const hook = installAutopilotHook(writer.engine, quietDeps);
    writer.engine.setAutopilotStateProvider(providerFor(hook));
    if (engaged) hook.start();
    expect(hook.engaged).toBe(engaged);
    await writer.engine.saveGame("auto");
    writer.dispose();
    clearWindowHook();
  }

  it("boot path: the autosave loads before the hook installs, then catches up (resumes)", async () => {
    const store = new MockSaveService();
    await writeEngagedAutosave(store, true);

    harness = await RealEngineHarness.boot({ saveService: store });
    const loaded = await harness.engine.loadGame("auto");
    expect(loaded).toBe(true);
    expect(harness.engine.getLoadedAutopilotEngaged()).toBe(true);

    clearWindowHook();
    attachDevAutopilot(true, harness.engine, quietLoader, (err) => {
      throw err;
    });
    await flush();

    expect(windowHook().engaged).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("continue path: the provider is already injected, so loadGame's tail resume fires directly", async () => {
    const store = new MockSaveService();
    await writeEngagedAutosave(store, true);

    harness = await RealEngineHarness.boot({ saveService: store });
    clearWindowHook();
    const hook = installAutopilotHook(harness.engine, quietDeps);
    harness.engine.setAutopilotStateProvider(providerFor(hook));
    expect(hook.engaged).toBe(false);

    const loaded = await harness.engine.loadGame("auto");
    expect(loaded).toBe(true);
    expect(hook.engaged).toBe(true);
    expect(harness.errors()).toEqual([]);
  });

  it("a save written with the autopilot OFF does not resume it", async () => {
    const store = new MockSaveService();
    await writeEngagedAutosave(store, false);

    harness = await RealEngineHarness.boot({ saveService: store });
    const loaded = await harness.engine.loadGame("auto");
    expect(loaded).toBe(true);
    expect(harness.engine.getLoadedAutopilotEngaged()).toBe(false);

    clearWindowHook();
    const hook = installAutopilotHook(harness.engine, quietDeps);
    harness.engine.setAutopilotStateProvider(providerFor(hook));
    await harness.engine.loadGame("auto");
    expect(hook.engaged).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
