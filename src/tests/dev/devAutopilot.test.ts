import { describe, it, expect, vi } from "vitest";
import {
  attachAutopilot,
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

describe("attachAutopilot — lazy production seam", () => {
  const makeTarget = () => {
    const listeners = new Set<(e: KeyboardEvent) => void>();
    return {
      listeners,
      addEventListener: (_t: string, l: (e: KeyboardEvent) => void) => {
        listeners.add(l);
      },
      removeEventListener: (_t: string, l: (e: KeyboardEvent) => void) => {
        listeners.delete(l);
      },
      press(code: string, init: Partial<KeyboardEvent> = {}) {
        for (const l of [...listeners]) {
          l({ code, repeat: false, target: null, ...init } as KeyboardEvent);
        }
      },
    };
  };

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
      getLoadedAutopilotEngaged: () => loadedEngaged,
    };
    return engine as unknown as GameEngine & {
      injected?: { isEngaged(): boolean; resume(engaged: boolean): void };
    };
  };

  const hookOf = () => ({ engaged: false, start: vi.fn(() => void 0) });
  const loaderOf = (hook: ReturnType<typeof hookOf>) =>
    vi
      .fn<() => Promise<AutopilotHookModule>>()
      .mockResolvedValue({ installAutopilotHook: () => hook });

  it("loads nothing at boot: the chunk waits for the hotkey", async () => {
    const engine = makeEngine(undefined);
    const target = makeTarget();
    const load = loaderOf(hookOf());

    attachAutopilot(engine, load, () => {}, target);
    await flush();

    expect(load).not.toHaveBeenCalled();
    expect(engine.injected).toBeDefined();
    expect(target.listeners.size).toBe(1);
  });

  it("the Backquote hotkey loads the engine once and starts it", async () => {
    const engine = makeEngine(undefined);
    const target = makeTarget();
    const hook = hookOf();
    const load = loaderOf(hook);

    attachAutopilot(engine, load, () => {}, target);
    target.press("Backquote");
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.start).toHaveBeenCalledTimes(1);
    expect(target.listeners.size).toBe(0);
  });

  it("ignores other keys, key repeat, modifiers and typing in form fields", async () => {
    const engine = makeEngine(undefined);
    const target = makeTarget();
    const load = loaderOf(hookOf());

    attachAutopilot(engine, load, () => {}, target);
    target.press("KeyA");
    target.press("Backquote", { repeat: true });
    target.press("Backquote", { ctrlKey: true });
    target.press("Backquote", { metaKey: true });
    target.press("Backquote", {
      target: { tagName: "INPUT" } as unknown as EventTarget,
    });
    target.press("Backquote", {
      target: { tagName: "TEXTAREA" } as unknown as EventTarget,
    });
    await flush();

    expect(load).not.toHaveBeenCalled();
  });

  it("a save that had the autopilot engaged loads and resumes it", async () => {
    const engine = makeEngine(undefined);
    const hook = hookOf();
    const load = loaderOf(hook);

    attachAutopilot(engine, load, () => {}, makeTarget());
    expect(engine.injected!.isEngaged()).toBe(false);
    engine.injected!.resume(false);
    await flush();
    expect(load).not.toHaveBeenCalled();

    engine.injected!.resume(true);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.start).toHaveBeenCalledTimes(1);
    hook.engaged = true;
    expect(engine.injected!.isEngaged()).toBe(true);
  });

  it("boot catch-up: an engaged boot save loads it straight away", async () => {
    const hook = hookOf();
    const load = loaderOf(hook);

    attachAutopilot(makeEngine(true), load, () => {}, makeTarget());
    await flush();

    expect(load).toHaveBeenCalledTimes(1);
    expect(hook.start).toHaveBeenCalledTimes(1);
  });

  it("a load fault is reported once and never throws; the next press may retry", async () => {
    const engine = makeEngine(undefined);
    const target = makeTarget();
    const boom = new Error("chunk 404");
    const load = vi
      .fn<() => Promise<AutopilotHookModule>>()
      .mockRejectedValueOnce(boom);
    const onError = vi.fn();

    attachAutopilot(engine, load, onError, target);
    target.press("Backquote");
    await flush();

    expect(onError).toHaveBeenCalledWith(boom);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(target.listeners.size).toBe(1);
  });

  it("works without a window (no hotkey, resume still available)", async () => {
    const engine = makeEngine(undefined);
    const hook = hookOf();

    expect(() =>
      attachAutopilot(engine, loaderOf(hook), () => {}, null),
    ).not.toThrow();
    engine.injected!.resume(true);
    await flush();
    expect(hook.start).toHaveBeenCalledTimes(1);
  });
});
