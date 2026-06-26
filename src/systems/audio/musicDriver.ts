import type { TrackKey } from "@/systems/AudioManager";
import { MusicDirector, type MusicContext } from "./musicDirector";

/**
 * The minimal audio surface the {@link MusicDriver} drives. The real
 * {@link AudioManager} satisfies it structurally; tests pass a fake that records
 * the {@link MusicSink.playTrack} calls.
 */
export interface MusicSink {
  playTrack(key: TrackKey): Promise<void> | void;
}

/**
 * Couples the pure {@link MusicDirector} to an {@link AudioManager}: computes the
 * track that *should* be playing for a context and starts it. `playTrack` is a
 * no-op for the already-playing track, so {@link MusicDriver.apply} is safe to
 * call every frame / state change — only a real change actually swaps the track
 * (with the existing 1 s cross-fade).
 *
 * Because the director folds in a combat **hysteresis** (combat music lingers for
 * a hold window after a fight disengages, so a brief skirmish doesn't thrash the
 * cross-fade), the revert to ambient only happens once that window elapses. That
 * is why the host re-evaluates each flight frame rather than once per engage/end
 * event: a single event fired at disengage would still return the held combat
 * track and never get a later chance to revert.
 */
export class MusicDriver {
  private readonly director = new MusicDirector();

  /**
   * Evaluate the desired track for `ctx` and start it via `sink` (no-op when the
   * director returns `null` — "leave the current track alone"). Returns the
   * desired track for assertion in tests.
   */
  apply(sink: MusicSink, ctx: MusicContext): TrackKey | null {
    const desired = this.director.desiredTrack(ctx);
    if (desired) void sink.playTrack(desired);
    return desired;
  }

  /** Reset the combat hysteresis (new game / engine teardown). */
  reset(): void {
    this.director.reset();
  }
}
