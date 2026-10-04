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

export interface KeyTarget {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(
    type: "keydown",
    listener: (e: KeyboardEvent) => void,
  ): void;
}

export const AUTOPILOT_LAUNCH_KEY = "Backquote";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
  } | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

export function attachAutopilot(
  engine: GameEngine,
  load: () => Promise<AutopilotHookModule>,
  onError: (err: unknown) => void = () => {},
  target: KeyTarget | null = typeof window !== "undefined" ? window : null,
): void {
  let hook: AutopilotHookHandle | null = null;
  let pending: Promise<AutopilotHookHandle | null> | null = null;

  const install = (): Promise<AutopilotHookHandle | null> => {
    pending ??= load()
      .then((mod) => {
        hook = mod.installAutopilotHook(engine);
        return hook;
      })
      .catch((err) => {
        onError(err);
        pending = null;
        return null;
      });
    return pending;
  };

  engine.setAutopilotStateProvider({
    isEngaged: () => hook?.engaged ?? false,
    resume: (engaged: boolean) => {
      if (engaged) void install().then((h) => h?.start());
    },
  });
  if (engine.getLoadedAutopilotEngaged() === true) {
    void install().then((h) => h?.start());
  }

  if (!target) return;
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== AUTOPILOT_LAUNCH_KEY || e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    void install().then((h) => {
      if (!h) return;
      target.removeEventListener("keydown", onKey);
      h.start();
    });
  };
  target.addEventListener("keydown", onKey);
}
