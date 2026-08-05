import type { TrackKey } from "@/systems/AudioManager";
import { MusicDirector, type MusicContext } from "./musicDirector";

export interface MusicSink {
  playTrack(key: TrackKey): Promise<void> | void;
}

export class MusicDriver {
  private readonly director = new MusicDirector();

  apply(sink: MusicSink, ctx: MusicContext): TrackKey | null {
    const desired = this.director.desiredTrack(ctx);
    if (desired) void sink.playTrack(desired);
    return desired;
  }

  reset(): void {
    this.director.reset();
  }
}
