import { describe, it, expect } from "vitest";
import { HullAlarm, type SfxSink } from "@/systems/audio/sfxCues";
import type { SfxKey } from "@/systems/AudioManager";

/** Fake AudioManager: records every SFX it is asked to play. */
function fakeSink(): SfxSink & { plays: SfxKey[] } {
  const plays: SfxKey[] = [];
  return {
    plays,
    playSfx(key: SfxKey) {
      plays.push(key);
    },
  };
}

describe("HullAlarm — low-hull warning edge", () => {
  it("fires the alarm once on the tick the hull crosses into the critical band", () => {
    const alarm = new HullAlarm();
    const sink = fakeSink();

    alarm.update(sink, false); // healthy
    alarm.update(sink, false);
    alarm.update(sink, true); // crossed low → fire
    alarm.update(sink, true); // still low → silent
    alarm.update(sink, true);

    expect(sink.plays).toEqual(["alarm"]);
  });

  it("does not fire while the hull stays healthy", () => {
    const alarm = new HullAlarm();
    const sink = fakeSink();
    for (let i = 0; i < 5; i++) alarm.update(sink, false);
    expect(sink.plays).toEqual([]);
  });

  it("re-arms after the hull recovers, so a second episode warns again", () => {
    const alarm = new HullAlarm();
    const sink = fakeSink();

    alarm.update(sink, true); // first crossing → fire
    alarm.update(sink, true); // held low → silent
    alarm.update(sink, false); // recovered → re-arm
    alarm.update(sink, true); // second crossing → fire

    expect(sink.plays).toEqual(["alarm", "alarm"]);
  });

  it("shouldFire returns the firing edge without a sink", () => {
    const alarm = new HullAlarm();
    expect(alarm.shouldFire(false)).toBe(false);
    expect(alarm.shouldFire(true)).toBe(true); // rising edge
    expect(alarm.shouldFire(true)).toBe(false); // held
    expect(alarm.shouldFire(false)).toBe(false); // falling
    expect(alarm.shouldFire(true)).toBe(true); // re-armed rising edge
  });

  it("reset re-arms so a fresh game warns again from the next crossing", () => {
    const alarm = new HullAlarm();
    const sink = fakeSink();

    alarm.update(sink, true); // fire
    alarm.update(sink, true); // held → silent
    alarm.reset();
    alarm.update(sink, true); // armed by reset → fire again

    expect(sink.plays).toEqual(["alarm", "alarm"]);
  });
});
