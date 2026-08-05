import { describe, it, expect } from "vitest";
import { MusicDriver, type MusicSink } from "@/systems/audio/musicDriver";
import {
  COMBAT_HOLD_MS,
  type MusicContext,
} from "@/systems/audio/musicDirector";
import type { TrackKey } from "@/systems/AudioManager";
import { SceneType } from "@/types";

function fakeSink(): MusicSink & { plays: TrackKey[] } {
  const plays: TrackKey[] = [];
  return {
    plays,
    playTrack(key: TrackKey) {
      plays.push(key);
    },
  };
}

function ctx(partial: Partial<MusicContext>): MusicContext {
  return {
    inCombat: false,
    scene: SceneType.SPACE_FLIGHT,
    now: 0,
    ...partial,
  };
}

describe("musicDriver — scene-change wiring", () => {
  it("starts each scene's ambient track", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();
    expect(driver.apply(sink, ctx({ scene: SceneType.SPACE_FLIGHT }))).toBe(
      "explore_calm",
    );
    expect(driver.apply(sink, ctx({ scene: SceneType.PLANET }))).toBe(
      "planet_hub",
    );
    expect(driver.apply(sink, ctx({ scene: SceneType.TRADE }))).toBe("market");
    expect(sink.plays).toEqual(["explore_calm", "planet_hub", "market"]);
  });

  it("does not touch the track for overlay scenes (null desired)", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();
    expect(driver.apply(sink, ctx({ scene: SceneType.DIALOGUE }))).toBeNull();
    expect(driver.apply(sink, ctx({ scene: SceneType.INVENTORY }))).toBeNull();
    expect(sink.plays).toEqual([]);
  });
});

describe("musicDriver — combat engage/end (per-frame loop)", () => {
  it("engaging a fight switches to combat, ending restores ambient", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();

    driver.apply(sink, ctx({ inCombat: false, now: 0 })); // explore_calm
    driver.apply(sink, ctx({ inCombat: true, now: 100 })); // combat
    driver.apply(sink, ctx({ inCombat: false, now: 200 })); // held → combat (no swap)
    driver.apply(sink, ctx({ inCombat: false, now: 200 + COMBAT_HOLD_MS + 1 })); // ambient

    const distinct = sink.plays.filter(
      (t, i) => i === 0 || sink.plays[i - 1] !== t,
    );
    expect(distinct).toEqual(["explore_calm", "combat", "explore_calm"]);
  });

  it("uses the boss track for the OVERMIND-core fight", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();
    expect(
      driver.apply(sink, ctx({ inCombat: true, boss: true, now: 0 })),
    ).toBe("combat_boss");
  });

  it("a brief skirmish never flaps back to ambient mid-fight", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();
    for (let i = 0; i < 6; i++) {
      driver.apply(sink, ctx({ inCombat: i % 2 === 0, now: i * 100 }));
    }
    expect(sink.plays).not.toContain("explore_calm");
    expect(sink.plays.every((t) => t === "combat")).toBe(true);
  });

  it("leaving the flight scene mid-hold reverts to the new scene immediately", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();
    driver.apply(sink, ctx({ inCombat: true, now: 0 })); // combat
    expect(
      driver.apply(
        sink,
        ctx({ scene: SceneType.PLANET, inCombat: false, now: 10 }),
      ),
    ).toBe("planet_hub");
  });
});

describe("musicDriver — reset", () => {
  it("clears the combat hold so ambient resumes immediately", () => {
    const driver = new MusicDriver();
    const sink = fakeSink();
    expect(driver.apply(sink, ctx({ inCombat: true, now: 0 }))).toBe("combat");
    driver.reset();
    expect(driver.apply(sink, ctx({ inCombat: false, now: 1 }))).toBe(
      "explore_calm",
    );
  });
});
