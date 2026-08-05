import type { GameEngine } from "@/systems/GameEngine";

export interface AutopilotHookHandle {
  readonly engaged: boolean;
  start(): void;
}

export interface AutopilotHookModule {
  installAutopilotHook(engine: GameEngine): AutopilotHookHandle;
}

export function attachDevAutopilot(
  isDev: boolean,
  engine: GameEngine,
  load: () => Promise<AutopilotHookModule>,
  onError: (err: unknown) => void = () => {},
): void {
  if (!isDev) return;
  void load()
    .then((mod) => {
      const hook = mod.installAutopilotHook(engine);
      engine.setAutopilotStateProvider({
        isEngaged: () => hook.engaged,
        resume: (engaged: boolean) => {
          if (engaged) hook.start();
        },
      });
      if (engine.getLoadedAutopilotEngaged() === true) hook.start();
    })
    .catch(onError);
}
