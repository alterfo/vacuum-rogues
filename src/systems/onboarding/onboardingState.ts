import type { HelpKey } from "./helpContent";

export const HELP_SEEN_KEY = "sr_help_seen";

export interface OnboardingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function liveStore(): OnboardingStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function readSeen(store: OnboardingStore | undefined): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(HELP_SEEN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function hasSeen(
  key: HelpKey,
  store: OnboardingStore | undefined = liveStore(),
): boolean {
  return readSeen(store).includes(key);
}

export function markSeen(
  key: HelpKey,
  store: OnboardingStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    const seen = readSeen(store);
    if (seen.includes(key)) return;
    seen.push(key);
    store.setItem(HELP_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage full / disabled — best-effort; the hint may reappear.
  }
}

export function resetSeen(
  store: OnboardingStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.removeItem(HELP_SEEN_KEY);
  } catch {
    // Best-effort.
  }
}
