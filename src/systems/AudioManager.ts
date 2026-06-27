import { logger } from "@/utils/logger";

/** Background music track keys (mapped to public/audio/mus_<key>.ogg). */
export type TrackKey =
  | "explore_calm"
  | "explore_wonder"
  | "tension_low"
  | "combat"
  | "combat_boss"
  | "overmind"
  | "planet_hub"
  | "market"
  | "equipment_shop"
  | "governor_dialogue"
  | "text_quest"
  | "station_pirate"
  | "station_science"
  | "menu_main"
  | "news_alert";

/** One-shot SFX keys (mapped to public/audio/sfx_<key>.ogg). */
export type SfxKey =
  | "warp"
  | "buy"
  | "sell"
  | "hit"
  | "land"
  | "reward"
  | "alarm"
  | "explosion"
  | "rankup"
  | "ui_click"
  | "ui_hover"
  | "toast";

const FADE_DURATION_MS = 1000;

/**
 * AudioManager wraps the Web Audio API to play background music tracks with
 * cross-fade and one-shot SFX. All audio is optional: if a file is missing the
 * call silently continues.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private currentTrackKey: TrackKey | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;
  private cache = new Map<string, AudioBuffer>();
  /**
   * URLs that have already failed to load (missing file / decode / network).
   * Negative-cached so a per-frame caller (the music driver re-evaluates every
   * frame) does not re-`fetch` + re-`logger.warn` a missing track every tick —
   * the common state, since audio files are optional/user-supplied.
   */
  private failedUrls = new Set<string>();
  private muted = false;
  private musicVolume = 0.7;
  private sfxVolume = 1.0;

  private getContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      return this.ctx;
    } catch {
      logger.warn("AudioManager: Web Audio API unavailable");
      return null;
    }
  }

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    // Already known-missing: skip the fetch + warn (per-frame callers).
    if (this.failedUrls.has(url)) return null;

    const ctx = this.getContext();
    if (!ctx) return null;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.warn(`AudioManager: audio not found at ${url}`);
        this.failedUrls.add(url);
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      this.cache.set(url, audioBuffer);
      return audioBuffer;
    } catch {
      logger.warn(`AudioManager: failed to load ${url}`);
      this.failedUrls.add(url);
      return null;
    }
  }

  private resolveUrl(prefix: "mus" | "sfx", key: string): string {
    return `/audio/${prefix}_${key}.ogg`;
  }

  /**
   * Play a background music track with a 1s fade-in. If the requested track is
   * already playing nothing happens. The previous track fades out in parallel.
   */
  async playTrack(key: TrackKey): Promise<void> {
    if (this.currentTrackKey === key) return;

    // Guard early to prevent concurrent calls from both passing the check above
    // before either finishes loading (race condition on rapid scene transitions).
    const prevKey = this.currentTrackKey;
    this.currentTrackKey = key;

    const ctx = this.getContext();
    if (!ctx || this.muted) {
      this.currentTrackKey = prevKey;
      return;
    }

    // Resume suspended context (browsers block autoplay until user gesture)
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    const buffer = await this.loadBuffer(this.resolveUrl("mus", key));
    if (!buffer) {
      this.currentTrackKey = prevKey;
      return;
    }
    // If a newer playTrack call superseded this one while we were awaiting, abort.
    if (this.currentTrackKey !== key) return;

    // Fade out current track
    this.fadeOutCurrent(ctx);

    // Start new track
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(
      this.musicVolume,
      ctx.currentTime + FADE_DURATION_MS / 1000,
    );
    gainNode.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainNode);
    source.start();

    this.currentSource = source;
    this.currentGain = gainNode;
    this.currentTrackKey = key;
  }

  /** Stop current track with a fade-out. */
  stopTrack(): void {
    const ctx = this.getContext();
    if (!ctx) return;
    this.fadeOutCurrent(ctx);
    this.currentTrackKey = null;
  }

  /** Play a one-shot sound effect. */
  async playSfx(key: SfxKey): Promise<void> {
    const ctx = this.getContext();
    if (!ctx || this.muted) return;

    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }

    const buffer = await this.loadBuffer(this.resolveUrl("sfx", key));
    if (!buffer) return;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(this.sfxVolume, ctx.currentTime);
    gainNode.connect(ctx.destination);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = false;
    source.connect(gainNode);
    source.start();
    source.onended = () => {
      source.disconnect();
      gainNode.disconnect();
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopTrack();
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.currentGain && this.ctx) {
      this.currentGain.gain.setValueAtTime(
        this.musicVolume,
        this.ctx.currentTime,
      );
    }
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
  }

  playUiClick(): void {
    this.playSfx("ui_click").catch(() => {});
  }

  playUiHover(): void {
    this.playSfx("ui_hover").catch(() => {});
  }

  playToast(): void {
    this.playSfx("toast").catch(() => {});
  }

  destroy(): void {
    this.fadeOutCurrent(this.ctx);
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.currentTrackKey = null;
    this.cache.clear();
    this.failedUrls.clear();
  }

  private fadeOutCurrent(ctx: AudioContext | null): void {
    if (!ctx || !this.currentGain || !this.currentSource) return;
    const gain = this.currentGain;
    const source = this.currentSource;
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(
      0,
      ctx.currentTime + FADE_DURATION_MS / 1000,
    );
    setTimeout(() => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }, FADE_DURATION_MS + 50);
    this.currentSource = null;
    this.currentGain = null;
  }
}
