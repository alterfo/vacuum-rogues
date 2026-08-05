import { isMobileDevice, type DeviceEnv } from "./isMobileDevice";

export const MOBILE_ACK_KEY = "sr_mobile_ack";

const ACK_VALUE = "1";

export interface MobileGateStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function liveStore(): MobileGateStore | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

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

export function shouldShowMobileGate(
  env?: DeviceEnv,
  store: MobileGateStore | undefined = liveStore(),
): boolean {
  return isMobileDevice(env) && !wasDismissed(store);
}
