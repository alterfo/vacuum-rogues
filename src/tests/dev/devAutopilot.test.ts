import { describe, it, expect, vi } from "vitest";
import {
  attachDevAutopilot,
  type AutopilotHookModule,
} from "@/dev/devAutopilot";
import type { GameEngine } from "@/systems/GameEngine";

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

describe("attachDevAutopilot — autopilot resume seam", () => {
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
