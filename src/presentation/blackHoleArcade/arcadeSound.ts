import type {
  ArcadeEvent,
  ArcadePickupKind,
  ArcadeWeaponId,
} from "@/systems/blackHoleArcade/arcadeTypes";

export const ARCADE_SOUND_STORAGE_KEY = "sr_arcade_sound";

export type ArcadeCue = "bossWarning" | "levelStart" | "won" | "lost";
export type ArcadeMusicMode = "off" | "calm" | "boss";

interface ToneSpec {
  type: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  gain: number;
  at?: number;
  attack?: number;
  bus?: "sfx" | "music";
  lowpass?: number;
}

interface NoiseSpec {
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  at?: number;
  bus?: "sfx" | "music";
}

export interface ArcadeSoundOptions {
  storage?: Storage | null;
  createContext?: () => AudioContext | null;
}

const MASTER_GAIN = 0.55;
const SFX_GAIN = 0.9;
const MUSIC_GAIN = 0.2;
const VOICE_CAP = 28;
const LOOKAHEAD_S = 0.25;
const SCHEDULER_MS = 40;
const BPM = 126;
const STEP_S = 60 / BPM / 4;
const SILENCE = 0.0001;

const ROOTS = [55, 65.41, 73.42, 82.41, 49];
const MINOR_PENTATONIC = [0, 3, 5, 7, 10];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const BASS_DEGREES = [0, 0, 3, 0, 4, 2];
const ARP_PATTERN = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 3, 1, 2, 4];

const MIN_GAP_S: Readonly<Record<string, number>> = {
  hit: 0.06,
  explosion: 0.035,
  fire_vulcan: 0.07,
  fire_laser: 0.07,
  fire_homing: 0.12,
  fire_wave: 0.1,
  fire_plasma: 0.12,
  fire_arc: 0.07,
  pickup: 0.04,
  blast: 0.05,
  arc: 0.05,
  playerHit: 0.08,
};

function defaultContext(): AudioContext | null {
  try {
    const scope = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function semitone(root: number, semis: number): number {
  return root * Math.pow(2, semis / 12);
}

export class ArcadeSound {
  private storage: Storage | null;
  private readonly createContext: () => AudioContext | null;
  private ctx: AudioContext | null = null;
  private contextFailed = false;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private on: boolean;
  private lastPlayed = new Map<string, number>();
  private voiceEnds: number[] = [];
  private musicMode: ArcadeMusicMode = "off";
  private musicTheme = 0;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;

  constructor(options: ArcadeSoundOptions = {}) {
    this.storage =
      options.storage === undefined ? defaultStorage() : options.storage;
    this.createContext = options.createContext ?? defaultContext;
    let stored: string | null = null;
    try {
      stored = this.storage?.getItem(ARCADE_SOUND_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
    this.on = stored !== "0";
  }

  get enabled(): boolean {
    return this.on;
  }

  toggle(): boolean {
    this.setEnabled(!this.on);
    return this.on;
  }

  setEnabled(value: boolean): void {
    this.on = value;
    this.persist(value);
    this.applyEnabled();
  }

  private persist(value: boolean): void {
    try {
      this.storage?.setItem(ARCADE_SOUND_STORAGE_KEY, value ? "1" : "0");
    } catch {
      this.storage = null;
    }
  }

  private applyEnabled(): void {
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(
        this.on ? MASTER_GAIN : 0,
        this.ctx.currentTime,
      );
    }
    if (this.on) this.startMusicTimer();
    else this.stopMusicTimer();
  }

  unlock(): void {
    if (!this.on) return;
    const ctx = this.ensureContext();
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
    this.startMusicTimer();
  }

  private ensureContext(): AudioContext | null {
    if (!this.on) return null;
    if (this.ctx) return this.ctx;
    if (this.contextFailed) return null;
    const ctx = this.createContext();
    if (!ctx) {
      this.contextFailed = true;
      return null;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(MASTER_GAIN, ctx.currentTime);
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.setValueAtTime(SFX_GAIN, ctx.currentTime);
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.setValueAtTime(MUSIC_GAIN, ctx.currentTime);
    this.musicBus.connect(this.master);
    return ctx;
  }

  private allow(key: string): boolean {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    const gap = MIN_GAP_S[key];
    if (gap !== undefined) {
      const last = this.lastPlayed.get(key);
      if (last !== undefined && ctx.currentTime - last < gap) return false;
      this.lastPlayed.set(key, ctx.currentTime);
    }
    return true;
  }

  private reserve(endTime: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    this.voiceEnds = this.voiceEnds.filter((t) => t > ctx.currentTime);
    if (this.voiceEnds.length >= VOICE_CAP) return false;
    this.voiceEnds.push(endTime);
    return true;
  }

  private bus(which: "sfx" | "music" | undefined): GainNode | null {
    return which === "music" ? this.musicBus : this.sfxBus;
  }

  private tone(spec: ToneSpec): void {
    const ctx = this.ctx;
    const out = this.bus(spec.bus);
    if (!ctx || !out) return;
    const t = ctx.currentTime + (spec.at ?? 0);
    const end = t + spec.dur;
    if (!this.reserve(end)) return;
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, t);
    if (spec.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, spec.freqEnd),
        end,
      );
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENCE, t);
    env.gain.linearRampToValueAtTime(spec.gain, t + (spec.attack ?? 0.004));
    env.gain.exponentialRampToValueAtTime(SILENCE, end);
    let tail: AudioNode = env;
    osc.connect(env);
    if (spec.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(spec.lowpass, t);
      env.connect(filter);
      tail = filter;
    }
    tail.connect(out);
    osc.start(t);
    osc.stop(end + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      if (tail !== env) tail.disconnect();
    };
  }

  private noise(spec: NoiseSpec): void {
    const ctx = this.ctx;
    const out = this.bus(spec.bus);
    if (!ctx || !out) return;
    const t = ctx.currentTime + (spec.at ?? 0);
    const end = t + spec.dur;
    if (!this.reserve(end)) return;
    if (!this.noiseBuffer) {
      const length = Math.max(1, Math.floor(ctx.sampleRate));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter;
    filter.frequency.setValueAtTime(spec.freq, t);
    if (spec.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, spec.freqEnd),
        end,
      );
    }
    filter.Q.setValueAtTime(spec.q ?? 0.8, t);
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENCE, t);
    env.gain.linearRampToValueAtTime(spec.gain, t + 0.003);
    env.gain.exponentialRampToValueAtTime(SILENCE, end);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    src.start(t);
    src.stop(end + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  private notes(
    freqs: readonly number[],
    gap: number,
    spec: Omit<ToneSpec, "freq" | "at">,
  ): void {
    freqs.forEach((freq, i) => this.tone({ ...spec, freq, at: i * gap }));
  }

  handle(event: ArcadeEvent): void {
    switch (event.kind) {
      case "fire":
        this.fire(event.weapon);
        break;
      case "hit":
        if (!this.allow("hit")) return;
        this.noise({ dur: 0.03, gain: 0.05, filter: "highpass", freq: 3000 });
        break;
      case "explosion":
        this.explosion(event.size);
        break;
      case "blast":
        if (!this.allow("blast")) return;
        this.noise({
          dur: 0.22,
          gain: 0.2,
          filter: "lowpass",
          freq: 1600,
          freqEnd: 180,
        });
        this.tone({
          type: "sine",
          freq: 140,
          freqEnd: 50,
          dur: 0.2,
          gain: 0.2,
        });
        break;
      case "pickup":
        this.pickup(event.pickup);
        break;
      case "bombStart":
        if (!this.allow("bomb")) return;
        this.noise({
          dur: 1.3,
          gain: 0.45,
          filter: "lowpass",
          freq: 3200,
          freqEnd: 90,
        });
        this.tone({
          type: "sine",
          freq: 110,
          freqEnd: 28,
          dur: 1.0,
          gain: 0.55,
        });
        this.tone({
          type: "sawtooth",
          freq: 440,
          freqEnd: 60,
          dur: 0.8,
          gain: 0.12,
          lowpass: 900,
        });
        break;
      case "arc":
        if (!this.allow("arc")) return;
        this.noise({
          dur: 0.1,
          gain: 0.12,
          filter: "bandpass",
          freq: 3200,
          freqEnd: 1200,
          q: 2,
        });
        this.tone({
          type: "sawtooth",
          freq: 2400,
          freqEnd: 500,
          dur: 0.08,
          gain: 0.05,
        });
        break;
      case "playerHit":
        if (!this.allow("playerHit")) return;
        if (event.shielded) {
          this.tone({
            type: "triangle",
            freq: 1500,
            freqEnd: 650,
            dur: 0.14,
            gain: 0.16,
          });
        } else {
          this.noise({
            dur: 0.22,
            gain: 0.3,
            filter: "lowpass",
            freq: 1200,
            freqEnd: 120,
          });
          this.tone({
            type: "sine",
            freq: 120,
            freqEnd: 50,
            dur: 0.2,
            gain: 0.32,
          });
        }
        break;
      case "levelClear":
        this.notes([523.25, 659.25, 783.99, 1046.5], 0.11, {
          type: "square",
          dur: 0.22,
          gain: 0.09,
          lowpass: 3000,
        });
        break;
      case "bossDown":
        this.explosion(260);
        this.notes([261.63, 329.63, 392, 523.25, 659.25], 0.14, {
          type: "square",
          dur: 0.3,
          gain: 0.1,
          lowpass: 2600,
        });
        break;
    }
  }

  private fire(weapon: ArcadeWeaponId): void {
    if (!this.allow(`fire_${weapon}`)) return;
    switch (weapon) {
      case "vulcan":
        this.tone({
          type: "square",
          freq: 900,
          freqEnd: 380,
          dur: 0.06,
          gain: 0.05,
          lowpass: 3500,
        });
        break;
      case "laser":
        this.tone({
          type: "sine",
          freq: 1900,
          freqEnd: 850,
          dur: 0.07,
          gain: 0.07,
        });
        this.tone({
          type: "triangle",
          freq: 3800,
          freqEnd: 1700,
          dur: 0.05,
          gain: 0.025,
        });
        break;
      case "homing":
        this.noise({
          dur: 0.2,
          gain: 0.07,
          filter: "bandpass",
          freq: 500,
          freqEnd: 2600,
          q: 1.5,
        });
        this.tone({
          type: "sawtooth",
          freq: 160,
          freqEnd: 420,
          dur: 0.16,
          gain: 0.04,
          lowpass: 900,
        });
        break;
      case "wave":
        this.tone({
          type: "triangle",
          freq: 420,
          freqEnd: 780,
          dur: 0.13,
          gain: 0.08,
        });
        this.tone({
          type: "sine",
          freq: 840,
          freqEnd: 420,
          dur: 0.13,
          gain: 0.04,
        });
        break;
      case "plasma":
        this.tone({
          type: "sine",
          freq: 240,
          freqEnd: 70,
          dur: 0.22,
          gain: 0.16,
        });
        this.noise({
          dur: 0.14,
          gain: 0.08,
          filter: "lowpass",
          freq: 1400,
          freqEnd: 250,
        });
        break;
      case "arc":
        this.noise({ dur: 0.07, gain: 0.05, filter: "highpass", freq: 2400 });
        break;
    }
  }

  private explosion(size: number): void {
    if (!this.allow("explosion")) return;
    const big = size > 100;
    const dur = Math.min(1.6, 0.26 + size / 260);
    const gain = Math.min(0.5, 0.14 + size / 520);
    this.noise({
      dur,
      gain,
      filter: "lowpass",
      freq: big ? 2400 : 1800,
      freqEnd: 120,
    });
    this.tone({
      type: "sine",
      freq: big ? 100 : 150,
      freqEnd: 34,
      dur: dur * 0.9,
      gain: gain * 1.1,
    });
    if (big) {
      this.noise({
        dur: dur * 1.2,
        gain: gain * 0.5,
        filter: "lowpass",
        freq: 300,
        freqEnd: 50,
        at: 0.05,
      });
    }
  }

  private pickup(kind: ArcadePickupKind): void {
    if (!this.allow("pickup")) return;
    const lead = {
      type: "square" as const,
      dur: 0.12,
      gain: 0.07,
      lowpass: 3600,
    };
    if (kind.startsWith("weapon_")) {
      this.notes([523.25, 659.25, 880], 0.07, lead);
      return;
    }
    switch (kind) {
      case "power":
        this.notes([440, 659.25, 880, 1318.5], 0.06, lead);
        break;
      case "repair_small":
        this.notes([587.33, 783.99], 0.09, {
          type: "sine",
          dur: 0.18,
          gain: 0.12,
        });
        break;
      case "repair_full":
        this.notes([523.25, 659.25, 783.99, 1046.5], 0.08, {
          type: "sine",
          dur: 0.22,
          gain: 0.12,
        });
        break;
      case "plating":
        this.tone({
          type: "square",
          freq: 196,
          freqEnd: 130,
          dur: 0.16,
          gain: 0.09,
          lowpass: 1200,
        });
        this.tone({
          type: "triangle",
          freq: 392,
          dur: 0.12,
          gain: 0.07,
          at: 0.06,
        });
        break;
      case "armor_coat":
        this.notes([392, 523.25, 783.99], 0.07, {
          type: "triangle",
          dur: 0.16,
          gain: 0.1,
        });
        break;
      case "shield":
        this.tone({
          type: "triangle",
          freq: 900,
          freqEnd: 1900,
          dur: 0.3,
          gain: 0.1,
        });
        this.tone({
          type: "sine",
          freq: 1350,
          freqEnd: 2800,
          dur: 0.3,
          gain: 0.05,
        });
        break;
      case "bomb":
        this.tone({
          type: "sawtooth",
          freq: 120,
          freqEnd: 90,
          dur: 0.22,
          gain: 0.12,
          lowpass: 600,
        });
        this.tone({ type: "square", freq: 330, dur: 0.1, gain: 0.06, at: 0.1 });
        break;
      case "wingman":
        this.notes([660, 880], 0.08, lead);
        break;
      case "magnet":
        this.tone({
          type: "sawtooth",
          freq: 200,
          freqEnd: 900,
          dur: 0.28,
          gain: 0.07,
          lowpass: 2000,
        });
        break;
      case "chip":
        this.notes([1318.5, 1760], 0.07, lead);
        break;
      default:
        this.tone({ type: "sine", freq: 880, dur: 0.1, gain: 0.08 });
    }
  }

  cue(name: ArcadeCue): void {
    if (!this.allow(`cue_${name}`)) return;
    switch (name) {
      case "bossWarning":
        for (let i = 0; i < 3; i++) {
          this.tone({
            type: "square",
            freq: 880,
            dur: 0.2,
            gain: 0.09,
            at: i * 0.44,
            lowpass: 2400,
          });
          this.tone({
            type: "square",
            freq: 622,
            dur: 0.2,
            gain: 0.09,
            at: i * 0.44 + 0.22,
            lowpass: 2400,
          });
        }
        break;
      case "levelStart":
        this.notes([392, 523.25, 659.25], 0.09, {
          type: "triangle",
          dur: 0.2,
          gain: 0.1,
        });
        break;
      case "won":
        this.notes(
          [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5],
          0.14,
          {
            type: "square",
            dur: 0.3,
            gain: 0.09,
            lowpass: 3000,
          },
        );
        break;
      case "lost":
        this.tone({
          type: "sawtooth",
          freq: 440,
          freqEnd: 70,
          dur: 1.2,
          gain: 0.16,
          lowpass: 1500,
        });
        this.noise({
          dur: 0.9,
          gain: 0.18,
          filter: "lowpass",
          freq: 1500,
          freqEnd: 80,
        });
        break;
    }
  }

  setMusic(mode: ArcadeMusicMode, theme: number): void {
    const t = Math.max(0, Math.floor(theme)) % ROOTS.length;
    if (mode === this.musicMode && t === this.musicTheme) return;
    this.musicMode = mode;
    this.musicTheme = t;
    if (mode === "off") {
      this.stopMusicTimer();
      return;
    }
    this.step = 0;
    this.nextStepTime = 0;
    if (this.on && this.ctx) this.startMusicTimer();
  }

  private startMusicTimer(): void {
    if (this.musicTimer !== null) return;
    if (!this.on || this.musicMode === "off" || !this.ctx) return;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.musicTimer = setInterval(() => this.pumpMusic(), SCHEDULER_MS);
  }

  private stopMusicTimer(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private pumpMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.on || this.musicMode === "off") return;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      this.scheduleStep(this.nextStepTime - ctx.currentTime, this.step);
      this.nextStepTime += STEP_S;
      this.step += 1;
    }
  }

  private scheduleStep(offset: number, index: number): void {
    const at = Math.max(0, offset);
    const root = ROOTS[this.musicTheme];
    const boss = this.musicMode === "boss";
    const s = index % 16;
    const scale = (degree: number, octave: number): number =>
      semitone(root * octave, MINOR_PENTATONIC[degree % 5]);

    const bassIdx = BASS_STEPS.indexOf(s);
    if (bassIdx >= 0 || (boss && s % 2 === 0)) {
      const degree = bassIdx >= 0 ? BASS_DEGREES[bassIdx] : 0;
      this.tone({
        type: "sawtooth",
        freq: scale(degree, 1),
        dur: STEP_S * 1.8,
        gain: boss ? 0.5 : 0.4,
        at,
        lowpass: boss ? 700 : 480,
        bus: "music",
      });
    }
    if (boss ? true : s % 2 === 0) {
      const degree = ARP_PATTERN[s];
      this.tone({
        type: "square",
        freq: scale(degree, 4),
        dur: STEP_S * 0.9,
        gain: boss ? 0.16 : 0.1,
        at,
        lowpass: 2600,
        bus: "music",
      });
    }
    if (boss) {
      if (s % 4 === 0) {
        this.tone({
          type: "sine",
          freq: 130,
          freqEnd: 42,
          dur: 0.14,
          gain: 0.7,
          at,
          bus: "music",
        });
      }
      if (s % 2 === 1) {
        this.noise({
          dur: 0.04,
          gain: 0.2,
          filter: "highpass",
          freq: 6500,
          at,
          bus: "music",
        });
      }
    }
  }

  destroy(): void {
    this.stopMusicTimer();
    this.musicMode = "off";
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
    this.voiceEnds = [];
    this.lastPlayed.clear();
    if (ctx) void ctx.close().catch(() => {});
  }
}
