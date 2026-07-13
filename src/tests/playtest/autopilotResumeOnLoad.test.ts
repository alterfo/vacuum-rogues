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

/**
 * Task 4 — end-to-end proof of the dev-only autopilot-resume seam over the
 * *real* {@link GameEngine} (not a mocked unit): engage the autopilot, write an
 * autosave, boot a **fresh** engine sharing that save store, and assert the
 * autopilot auto-resumed. This is the only tier that validates Task 1's
 * boot-vs-continue sequencing decision was actually correct (that the boot
 * auto-load, which resolves *before* the hook is installed, is caught up), not
 * merely internally consistent.
 */
vi.mock("pixi.js", async () => (await import("./pixiStub")).makePixiStub());

/** A scheduler that captures `onTick` but never fires it — no real timer in tests. */
const inertScheduler: AutopilotScheduler = { start: () => () => {} };

/** Deps that keep the controller off real timers / window listeners / the DOM. */
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

/** Build the dev provider exactly as `devAutopilot.ts` does, from a live hook. */
function providerFor(hook: AutopilotWindowHook): IAutopilotStateProvider {
  return {
    isEngaged: () => hook.engaged,
    resume: (engaged: boolean) => {
      if (engaged) hook.start();
    },
  };
}

/** Load the dev hook module the way the DEV chunk does, but with quiet deps. */
const quietLoader = () =>
  Promise.resolve({
    installAutopilotHook: (engine: GameEngine) =>
      installAutopilotHook(engine, quietDeps),
  });

/** Drain the microtask + macrotask queue so the load→install chain settles. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("Autopilot resumes from an autosave on reload (real engine)", () => {
  let harness: RealEngineHarness | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    clearWindowHook();
  });

  /**
   * Write an autosave with the DEV autopilot in `engaged` state into `store`,
   * using a first, disposable engine. Mirrors a live session that engaged the
   * autopilot and then hit a scene-transition autosave.
   */
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

    // Fresh engine, shared store. Simulate the boot auto-load running BEFORE the
    // DEV hook exists: the provider is still the headless no-op, so the tail
    // resume() no-ops — but the loaded flag is recorded for the catch-up.
    harness = await RealEngineHarness.boot({ saveService: store });
    const loaded = await harness.engine.loadGame("auto");
    expect(loaded).toBe(true);
    expect(harness.engine.getLoadedAutopilotEngaged()).toBe(true);

    // Now the DEV wiring installs the hook, injects the real provider, and
    // replays the missed boot resume via getLoadedAutopilotEngaged().
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
    // DEV wiring already ran (hook installed + provider injected) BEFORE the
    // user-triggered continue — the continue path's loadGame resumes directly.
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
    // Re-loading with the provider present must not spuriously engage.
    await harness.engine.loadGame("auto");
    expect(hook.engaged).toBe(false);
    expect(harness.errors()).toEqual([]);
  });
});
