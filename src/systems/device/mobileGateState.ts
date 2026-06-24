// Persistence for the soft mobile boot gate's "I dismissed the notice" flag
// (`docs/plans/20260623-mobile-device-soft-gate.md`).
//
// Browser-level `localStorage` only — the same kind of flag as `sr_settings` /
// `sr_help_seen`, so there is no save-schema/migration change. The store is
// injectable so tests drive a fake without the real `localStorage`, and every
// access is wrapped in `typeof`/try-guards: a runtime that lacks `localStorage`
// (a bare Node import / Vitest, or a browser with storage disabled) degrades to
// "not dismissed" / no-op rather than throwing — keeping the gate soft.

import { isMobileDevice, type DeviceEnv } from "./isMobileDevice";

/** localStorage key recording that the visitor acknowledged the mobile notice. */
export const MOBILE_ACK_KEY = "sr_mobile_ack";

/** Value written under {@link MOBILE_ACK_KEY} when the notice is dismissed. */
const ACK_VALUE = "1";

/** Minimal injectable view of the persistence store (a `Storage` subset). */
export interface MobileGateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The live `localStorage`, or `undefined` when the runtime lacks it. */
function liveStore(): MobileGateStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    // Accessing `localStorage` can throw in sandboxed/disabled-storage contexts.
    return undefined;
  }
}

/**
 * True once the visitor has dismissed the mobile notice on this device. Degrades
 * to `false` when storage is unavailable or unreadable (the gate may show again,
 * which is harmless — it's soft).
 */
export function wasDismissed(
  store: MobileGateStore | undefined = liveStore(),
): boolean {
  if (!store) return false;
  try {
    return store.getItem(MOBILE_ACK_KEY) === ACK_VALUE;
  } catch {
    return false;
  }
}

/**
 * Record that the visitor dismissed the mobile notice, so it won't nag on every
 * load. No-op (best-effort) when storage is unavailable or write-blocked.
 */
export function markDismissed(
  store: MobileGateStore | undefined = liveStore(),
): void {
  if (!store) return;
  try {
    store.setItem(MOBILE_ACK_KEY, ACK_VALUE);
  } catch {
    // Storage full / disabled — best-effort; the soft gate may reappear.
  }
}

/**
 * Pure decision for the boot gate: show the soft mobile notice when the device
 * looks phone-class **and** the visitor hasn't already dismissed it. `env`/`store`
 * are injectable for tests and default to the live `window`/`navigator` and
 * `localStorage`.
 */
export function shouldShowMobileGate(
  env?: DeviceEnv,
  store: MobileGateStore | undefined = liveStore(),
): boolean {
  return isMobileDevice(env) && !wasDismissed(store);
}
