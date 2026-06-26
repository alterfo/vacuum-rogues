import type { SfxKey } from "@/systems/AudioManager";

/**
 * The minimal SFX surface the cue drivers drive. The real {@link AudioManager}
 * satisfies it structurally; tests pass a fake that records the
 * {@link SfxSink.playSfx} calls.
 */
export interface SfxSink {
  playSfx(key: SfxKey): Promise<void> | void;
}

/**
 * Edge-triggered low-hull alarm. Most SFX cues (jump, buy, sell, rank-up) fire
 * at a discrete event, so they just call `playSfx` at the call site. The
 * low-hull warning is the exception: `lowHull` is a **level** re-derived every
 * frame from the player ship, so naively playing the alarm whenever it is true
 * would spam the cue every tick. {@link HullAlarm} folds the level into an edge:
 * it fires the alarm SFX **once** on the tick the hull drops into the critical
 * band and re-arms only once the hull recovers above it — so a single warning
 * sounds per damage episode, not a continuous siren.
 */
export class HullAlarm {
  /** Whether the hull was already in the critical band on the previous tick. */
  private wasLow = false;

  /**
   * Feed the current "hull is critically low" level. Returns true on the tick it
   * first becomes true (the rising edge); re-arms once `low` clears.
   */
  shouldFire(low: boolean): boolean {
    const fire = low && !this.wasLow;
    this.wasLow = low;
    return fire;
  }

  /** Drive a sink: play the alarm SFX on the firing edge only. */
  update(sink: SfxSink, low: boolean): void {
    if (this.shouldFire(low)) void sink.playSfx("alarm");
  }

  /** Reset the armed state (new game / engine teardown). */
  reset(): void {
    this.wasLow = false;
  }
}
