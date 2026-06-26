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
    const load = vi.fn<[], Promise<AutopilotHookModule>>();

    attachDevAutopilot(false, fakeEngine, load);

    await flush();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads + installs the hook over the live engine in a DEV build", async () => {
    const installAutopilotHook = vi.fn();
    const load = vi
      .fn<[], Promise<AutopilotHookModule>>()
      .mockResolvedValue({ installAutopilotHook });

    attachDevAutopilot(true, fakeEngine, load);

    expect(load).toHaveBeenCalledTimes(1);
    await flush();
    expect(installAutopilotHook).toHaveBeenCalledWith(fakeEngine);
  });

  it("routes a load/install fault to onError instead of throwing", async () => {
    const boom = new Error("dev chunk missing");
    const load = vi
      .fn<[], Promise<AutopilotHookModule>>()
      .mockRejectedValue(boom);
    const onError = vi.fn();

    expect(() =>
      attachDevAutopilot(true, fakeEngine, load, onError),
    ).not.toThrow();

    await flush();
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
