export function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface ReducedMotionTarget {
  setReducedMotion: (value: boolean) => void;
}

export function applyReducedMotion(
  enabled: boolean,
  targets: readonly (ReducedMotionTarget | null | undefined)[],
): void {
  if (!enabled) return;
  for (const target of targets) {
    target?.setReducedMotion(true);
  }
}
