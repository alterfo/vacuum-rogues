import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioManager } from "@/systems/AudioManager";

// AudioContext is not available in jsdom — mock the whole thing.
class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class MockBufferSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioContext {
  static lastInstance: MockAudioContext | null = null;
  state = "running";
  currentTime = 0;
  createGain = vi.fn(() => new MockGainNode());
  createBufferSource = vi.fn(() => new MockBufferSource());
  decodeAudioData = vi.fn(async (_buf: ArrayBuffer) => ({}) as AudioBuffer);
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  destination = {};
  constructor() {
    MockAudioContext.lastInstance = this;
  }
}

// Stub global AudioContext
vi.stubGlobal("AudioContext", MockAudioContext);

// Stub global fetch so loadBuffer returns a valid buffer
vi.stubGlobal(
  "fetch",
  vi.fn(async (_url: string) => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })),
);

describe("AudioManager", () => {
  let mgr: AudioManager;

  beforeEach(() => {
    mgr = new AudioManager();
  });

  it("plays a track and remembers currentTrackKey", async () => {
    await mgr.playTrack("menu_main");
    // The AudioContext was created and a buffer source was started —
    // the internal current track key should be set.
    // We verify indirectly: calling playTrack again with the same key is a no-op
    // (does not call fetch a second time for the same resource).
    const fetchFn = vi.mocked(fetch);
    const callsBefore = fetchFn.mock.calls.length;
    await mgr.playTrack("menu_main");
    // Same key → early return, no new fetch
    expect(fetchFn.mock.calls.length).toBe(callsBefore);
  });

  it("different track triggers a new fetch", async () => {
    await mgr.playTrack("explore_calm");
    const fetchFn = vi.mocked(fetch);
    const callsBefore = fetchFn.mock.calls.length;
    await mgr.playTrack("combat");
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("playSfx fires a fetch for the SFX url", async () => {
    const fetchFn = vi.mocked(fetch);
    fetchFn.mockClear();
    await mgr.playSfx("warp");
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining("sfx_warp"));
  });

  it("muted flag silences playTrack", async () => {
    mgr.setMuted(true);
    const fetchFn = vi.mocked(fetch);
    fetchFn.mockClear();
    await mgr.playTrack("menu_main");
    // When muted, getContext returns but the early-return guard fires after
    // checking muted — no fetch should happen.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("setMusicVolume clamps to 0..1", () => {
    mgr.setMusicVolume(2.5);
    expect(mgr.getMusicVolume()).toBe(1);
    mgr.setMusicVolume(-1);
    expect(mgr.getMusicVolume()).toBe(0);
  });

  it("stopTrack clears the current track key so the same track can replay", async () => {
    await mgr.playTrack("planet_hub");
    const ctxInstance = MockAudioContext.lastInstance!;
    ctxInstance.createBufferSource.mockClear();
    mgr.stopTrack();
    // After stopTrack, the key is cleared — playing the same track again
    // must call createBufferSource (not early-return due to same-key guard).
    await mgr.playTrack("planet_hub");
    expect(ctxInstance.createBufferSource).toHaveBeenCalled();
  });

  it("gracefully handles missing audio files (fetch returns 404)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);
    // Should not throw
    await expect(mgr.playSfx("buy")).resolves.toBeUndefined();
  });

  it("destroy closes the AudioContext", async () => {
    await mgr.playTrack("explore_calm");
    const ctxInstance = MockAudioContext.lastInstance!;
    mgr.destroy();
    expect(ctxInstance.close).toHaveBeenCalled();
  });
});
