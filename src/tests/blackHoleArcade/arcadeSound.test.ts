import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ARCADE_SOUND_STORAGE_KEY,
  ArcadeSound,
} from "@/presentation/blackHoleArcade/arcadeSound";
import {
  ARCADE_PICKUP_KINDS,
  ARCADE_WEAPON_IDS,
  type ArcadeEvent,
} from "@/systems/blackHoleArcade/arcadeTypes";

class FakeParam {
  value = 0;
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connected: unknown[] = [];
  connect(target: unknown): unknown {
    this.connected.push(target);
    return target;
  }
  disconnect(): void {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeOsc extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0): void {
    this.started = t;
  }
  stop(t = 0): void {
    this.stopped = t;
  }
}

class FakeSource extends FakeOsc {
  buffer: unknown = null;
  loop = false;
}

class FakeContext {
  static last: FakeContext | null = null;
  currentTime = 0;
  state = "suspended";
  destination = new FakeNode();
  sampleRate = 44100;
  oscillators: FakeOsc[] = [];
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  closed = false;
  resumed = 0;
  constructor() {
    FakeContext.last = this;
  }
  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    this.oscillators.push(o);
    return o;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBuffer(
    _c: number,
    length: number,
  ): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(length) };
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter();
  }
  resume(): Promise<void> {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  voices(): number {
    return this.oscillators.length + this.sources.length;
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

function make(initial: Record<string, string> = {}) {
  const storage = memoryStorage(initial);
  const sound = new ArcadeSound({
    storage: storage as unknown as Storage,
    createContext: () => new FakeContext() as unknown as AudioContext,
  });
  return { sound, storage };
}

const ctxOf = () => FakeContext.last as FakeContext;

const ALL_EVENTS: ArcadeEvent[] = [
  { kind: "explosion", x: 0, y: 0, size: 40 },
  { kind: "explosion", x: 0, y: 0, size: 200 },
  { kind: "hit", x: 0, y: 0 },
  { kind: "blast", x: 0, y: 0, radius: 80 },
  { kind: "bombStart" },
  {
    kind: "arc",
    points: [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ],
  },
  { kind: "playerHit", shielded: true },
  { kind: "playerHit", shielded: false },
  { kind: "levelClear", level: 1 },
  { kind: "bossDown" },
  { kind: "fire", weapon: "vulcan" },
];

beforeEach(() => {
  FakeContext.last = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("arcade sound: on/off", () => {
  it("is on by default and remembers the choice", () => {
    const first = make();
    expect(first.sound.enabled).toBe(true);
    expect(first.sound.toggle()).toBe(false);
    expect(first.storage.data.get(ARCADE_SOUND_STORAGE_KEY)).toBe("0");

    const second = make({ [ARCADE_SOUND_STORAGE_KEY]: "0" });
    expect(second.sound.enabled).toBe(false);
    second.sound.setEnabled(true);
    expect(second.storage.data.get(ARCADE_SOUND_STORAGE_KEY)).toBe("1");
  });

  it("makes no audio at all while disabled, not even a context", () => {
    const { sound } = make({ [ARCADE_SOUND_STORAGE_KEY]: "0" });
    sound.unlock();
    for (const event of ALL_EVENTS) sound.handle(event);
    sound.cue("won");
    sound.setMusic("boss", 2);
    vi.advanceTimersByTime(2000);
    expect(FakeContext.last).toBeNull();
  });

  it("muting silences the master bus and stops the music", () => {
    const { sound } = make();
    sound.unlock();
    sound.setMusic("calm", 0);
    sound.setEnabled(false);
    const c = ctxOf();
    const master = c.gains[0];
    expect(master.gain.value).toBe(0);
    const voices = c.voices();
    c.currentTime += 5;
    vi.advanceTimersByTime(3000);
    expect(c.voices()).toBe(voices);
    sound.handle({ kind: "bombStart" });
    expect(c.voices()).toBe(voices);
    sound.setEnabled(true);
    expect(master.gain.value).toBeGreaterThan(0);
  });

  it("survives an environment without Web Audio", () => {
    const sound = new ArcadeSound({
      storage: memoryStorage() as unknown as Storage,
      createContext: () => null,
    });
    expect(() => {
      sound.unlock();
      for (const event of ALL_EVENTS) sound.handle(event);
      sound.setMusic("calm", 1);
      sound.destroy();
    }).not.toThrow();
    expect(sound.toggle()).toBe(false);
  });

  it("survives broken storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const sound = new ArcadeSound({
      storage: broken as unknown as Storage,
      createContext: () => new FakeContext() as unknown as AudioContext,
    });
    expect(sound.enabled).toBe(true);
    expect(() => sound.toggle()).not.toThrow();
    expect(sound.enabled).toBe(false);
  });
});

describe("arcade sound: effects", () => {
  it("unlocking resumes a suspended context", () => {
    const { sound } = make();
    sound.unlock();
    expect(ctxOf().resumed).toBeGreaterThan(0);
  });

  it("every event kind makes a sound without throwing", () => {
    const { sound } = make();
    sound.unlock();
    for (const event of ALL_EVENTS) {
      const c = ctxOf();
      c.currentTime += 1;
      const before = c.voices();
      expect(() => sound.handle(event)).not.toThrow();
      expect(c.voices(), JSON.stringify(event)).toBeGreaterThan(before);
    }
  });

  it("every weapon and every pickup has its own sound", () => {
    const { sound } = make();
    sound.unlock();
    for (const weapon of ARCADE_WEAPON_IDS) {
      const c = ctxOf();
      c.currentTime += 1;
      const before = c.voices();
      sound.handle({ kind: "fire", weapon });
      expect(c.voices(), weapon).toBeGreaterThan(before);
    }
    for (const pickup of ARCADE_PICKUP_KINDS) {
      const c = ctxOf();
      c.currentTime += 1;
      const before = c.voices();
      sound.handle({ kind: "pickup", x: 0, y: 0, pickup });
      expect(c.voices(), pickup).toBeGreaterThan(before);
    }
  });

  it("every named cue plays", () => {
    const { sound } = make();
    sound.unlock();
    for (const cue of ["bossWarning", "levelStart", "won", "lost"] as const) {
      const c = ctxOf();
      c.currentTime += 1;
      const before = c.voices();
      sound.cue(cue);
      expect(c.voices(), cue).toBeGreaterThan(before);
    }
  });

  it("a fast stream of the same effect is rate limited", () => {
    const { sound } = make();
    sound.unlock();
    const c = ctxOf();
    c.currentTime = 10;
    sound.handle({ kind: "hit", x: 0, y: 0 });
    const one = c.voices();
    sound.handle({ kind: "hit", x: 0, y: 0 });
    sound.handle({ kind: "hit", x: 0, y: 0 });
    expect(c.voices()).toBe(one);
    c.currentTime = 10.2;
    sound.handle({ kind: "hit", x: 0, y: 0 });
    expect(c.voices()).toBeGreaterThan(one);
  });

  it("a storm of explosions cannot flood the audio graph", () => {
    const { sound } = make();
    sound.unlock();
    const c = ctxOf();
    c.currentTime = 20;
    for (let i = 0; i < 200; i++) {
      sound.handle({ kind: "explosion", x: 0, y: 0, size: 60 });
    }
    expect(c.voices()).toBeLessThan(60);
  });

  it("big explosions ring out longer than small ones", () => {
    const { sound } = make();
    sound.unlock();
    const c = ctxOf();
    c.currentTime = 30;
    sound.handle({ kind: "explosion", x: 0, y: 0, size: 30 });
    const smallDur = Math.max(...c.sources.map((s) => s.stopped ?? 0)) - 30;
    c.currentTime = 40;
    c.sources.length = 0;
    sound.handle({ kind: "explosion", x: 0, y: 0, size: 240 });
    const bigDur = Math.max(...c.sources.map((s) => s.stopped ?? 0)) - 40;
    expect(bigDur).toBeGreaterThan(smallDur);
  });

  it("finished voices clean up after themselves", () => {
    const { sound } = make();
    sound.unlock();
    sound.handle({ kind: "bombStart" });
    for (const node of [...ctxOf().oscillators, ...ctxOf().sources]) {
      expect(typeof node.onended).toBe("function");
    }
  });
});

describe("arcade sound: music", () => {
  it("plays while a mode is set, and stops when turned off", () => {
    const { sound } = make();
    sound.unlock();
    const c = ctxOf();
    sound.setMusic("calm", 0);
    for (let i = 0; i < 30; i++) {
      c.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    const played = c.voices();
    expect(played).toBeGreaterThan(10);
    sound.setMusic("off", 0);
    for (let i = 0; i < 20; i++) {
      c.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    expect(c.voices()).toBe(played);
  });

  it("the boss mode is denser than the calm mode", () => {
    const count = (mode: "calm" | "boss") => {
      FakeContext.last = null;
      const { sound } = make();
      sound.unlock();
      const c = ctxOf();
      sound.setMusic(mode, 1);
      for (let i = 0; i < 60; i++) {
        c.currentTime += 0.1;
        vi.advanceTimersByTime(100);
      }
      sound.destroy();
      return c.voices();
    };
    expect(count("boss")).toBeGreaterThan(count("calm"));
  });

  it("setting the same mode twice does not double the music", () => {
    const { sound } = make();
    sound.unlock();
    const c = ctxOf();
    sound.setMusic("calm", 0);
    sound.setMusic("calm", 0);
    sound.setMusic("calm", 0);
    for (let i = 0; i < 20; i++) {
      c.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    const once = c.voices();

    FakeContext.last = null;
    const solo = make();
    solo.sound.unlock();
    const c2 = ctxOf();
    solo.sound.setMusic("calm", 0);
    for (let i = 0; i < 20; i++) {
      c2.currentTime += 0.1;
      vi.advanceTimersByTime(100);
    }
    expect(once).toBe(c2.voices());
  });

  it("destroy closes the context and stops all timers", () => {
    const { sound } = make();
    sound.unlock();
    const c = ctxOf();
    sound.setMusic("boss", 3);
    sound.destroy();
    expect(c.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(() => sound.handle({ kind: "bombStart" })).not.toThrow();
  });
});
