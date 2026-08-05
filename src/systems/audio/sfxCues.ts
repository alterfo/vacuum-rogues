import type { SfxKey } from "@/systems/AudioManager";

export interface SfxSink {
  playSfx(key: SfxKey): Promise<void> | void;
}

export class HullAlarm {
  private wasLow = false;

  shouldFire(low: boolean): boolean {
    const fire = low && !this.wasLow;
    this.wasLow = low;
    return fire;
  }

  update(sink: SfxSink, low: boolean): void {
    if (this.shouldFire(low)) void sink.playSfx("alarm");
  }

  reset(): void {
    this.wasLow = false;
  }
}
