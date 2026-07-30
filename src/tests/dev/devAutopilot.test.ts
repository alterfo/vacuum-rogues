import { describe, it, expect, vi } from "vitest";
import {
  attachDevAutopilot,
  type AutopilotHookModule,
} from "@/dev/devAutopilot";
import type { GameEngine } from "@/systems/GameEngine";

/**
 * Task 3 of the dev-autopilot plan: the **dev-only gate is absent in a non-DEV
 * build**. {@link attachDevAutopilot} is the single production seam that pulls in
 * the (otherwise dev-only, never-bundled) autopilot; this pins that when `isDev`
 * is false it loads + attaches *nothing*, and when true it loads the hook module
 * and installs it over the live engine. The build-time chunk exclusion is the
 * separate concern of the `import.meta.env.DEV`-guarded call site in `main.ts`
 * (covered by the dev-only guard test); here we lock the runtime contract.
 */
/** Drain the microtask + macrotask queue so the load→install promise chain settles. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("attachDevAutopilot — dev-only runtime gate", () => {
  const fakeEngine = {} as GameEngine;

  it("attaches nothing in a non-DEV build (load is never called)", async () => {
    const load = vi.fn<() => Promise<AutopilotHookModule>>();

    attachDevAutopilot(false, fakeEngine, load);

    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads + installs the hook over the live engine in a DEV build", async () => {
    // A minimal engine exposing the two methods the install path calls, so the
    // happy path runs to completion instead of throwing into the swallowed
    // onError (which would let a broken install path still pass this test).
    const engine = {
      setAutopilotStateProvider: vi.fn(),
      getLoadedAutopilotEngaged: () => undefined,
    } as unknown as GameEngine;
    const hook = { engaged: false, start: vi.fn() };
    const installAutopilotHook = vi.fn(() => hook);
    const load = vi
      .fn<() => Promise<AutopilotHookModule>>()
      .mockResolvedValue({ installAutopilotHook });
    const onError = vi.fn();

    attachDevAutopilot(true, engine, load, onError);

    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(installAutopilotHook).toHaveBeenCalledWith(engine);
    // The install path completed cleanly — no fault was routed to onError.
    expect(onError).not.toHaveBeenCalled();
    expect(engine.setAutopilotStateProvider).toHaveBeenCalledTimes(1);
  });

  it("routes a load/install fault to onError instead of throwing", async () => {
    const boom = new Error("dev chunk missing");
    const load = vi
      .fn<() => Promise<AutopilotHookModule>>()
      .mockRejectedValue(boom);
    const onError = vi.fn();

    expect(() =>
      attachDevAutopilot(true, fakeEngine, load, onError),
    ).not.toThrow();

    await flush();
    expect(onError).toHaveBeenCalledWith(boom);
  });
});

/**
 * Task 4: the autopilot-resume seam. After installing the hook,
 * {@link attachDevAutopilot} must (a) inject an {@link IAutopilotStateProvider}
 * whose `resume(true)` re-engages via the hook, and (b) replay the boot
 * auto-load's missed resume by reading `getLoadedAutopilotEngaged()` once and
 * `start()`-ing when it was `true`. These pin that a save written while engaged
 * auto-resumes, and one written while *off* (or an old save with the flag
 * absent) never spuriously starts.
 */
describe("attachDevAutopilot — autopilot resume seam", () => {
  /** A fake engine capturing the injected provider + a configurable boot flag. */
  const makeEngine = (loadedEngaged: boolean | undefined) => {
    const engine = {
      injected: undefined as
        | { isEngaged(): boolean; resume(engaged: boolean): void }
        | undefined,
      setAutopilotStateProvider(p: {
        isEngaged(): boolean;
        resume(engaged: boolean): void;
      }) {
        engine.injected = p;
      },
      getLoadedAutopilotEngaged() {
        return loadedEngaged;
      },
    };
    return engine as unknown as GameEngine & {
      injected?: { isEngaged(): boolean; resume(engaged: boolean): void };
    };
  };

  const makeHook = () => {
    const hook = { engaged: false, start: vi.fn(() => void 0) };
    return hook;
  };

  const loaderFor = (hook: { engaged: boolean; start: () => void }) =>
    vi
      .fn<() => Promise<AutopilotHookModule>>()
      .mockResolvedValue({ installAutopilotHook: () => hook });

  it("injects a provider whose resume(true) re-engages the hook", async () => {
    const engine = makeEngine(undefined);
    const hook = makeHook();

    attachDevAutopilot(true, engine, loaderFor(hook));
    await flush();

    expect(engine.injected).toBeDefined();
    engine.injected!.resume(true);
    expect(hook.start).toHaveBeenCalledTimes(1);
  });

  it("injects a provider whose resume(false) does NOT engage the hook", async () => {
    const engine = makeEngine(undefined);
    const hook = makeHook();

    attachDevAutopilot(true, engine, loaderFor(hook));
    await flush();

    engine.injected!.resume(false);
    expect(hook.start).not.toHaveBeenCalled();
  });

  it("provider.isEngaged() reflects the live hook engaged flag", async () => {
    const engine = makeEngine(undefined);
    const hook = makeHook();

    attachDevAutopilot(true, engine, loaderFor(hook));
    await flush();

    expect(engine.injected!.isEngaged()).toBe(false);
    hook.engaged = true;
    expect(engine.injected!.isEngaged()).toBe(true);
  });

  it("boot catch-up: start()s when the boot auto-load was engaged", async () => {
    const engine = makeEngine(true);
    const hook = makeHook();

    attachDevAutopilot(true, engine, loaderFor(hook));
    await flush();

    expect(hook.start).toHaveBeenCalledTimes(1);
  });

  it("boot catch-up: does NOT start when the boot flag is false", async () => {
    const engine = makeEngine(false);
    const hook = makeHook();

    attachDevAutopilot(true, engine, loaderFor(hook));
    await flush();

    expect(hook.start).not.toHaveBeenCalled();
  });

  it("boot catch-up: does NOT start when the boot flag is absent (old save)", async () => {
    const engine = makeEngine(undefined);
    const hook = makeHook();

    attachDevAutopilot(true, engine, loaderFor(hook));
    await flush();

    expect(hook.start).not.toHaveBeenCalled();
  });
});
