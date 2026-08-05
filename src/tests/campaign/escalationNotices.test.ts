import { describe, it, expect } from "vitest";
import {
  activeEscalationStages,
  EscalationNoticeTracker,
  ESCALATION_STAGES,
  type EscalationInputs,
} from "@/systems/campaign/escalationNotices";
import { GAME_BALANCE, ESCALATION_NOTICED_POWER } from "@/config/balance";

const WARNING = GAME_BALANCE.OVERMIND_WARNING_THRESHOLD;

function inputs(over: Partial<EscalationInputs> = {}): EscalationInputs {
  return {
    peakPower: 0,
    overmindShare: 0,
    arcStatus: "dormant",
    ...over,
  };
}

describe("activeEscalationStages (pure)", () => {
  it("returns no stages for a fresh weak-player galaxy", () => {
    expect(activeEscalationStages(inputs())).toEqual([]);
  });

  it("NOTICED fires at the ratcheted-power threshold, not below it", () => {
    expect(
      activeEscalationStages(
        inputs({ peakPower: ESCALATION_NOTICED_POWER - 0.001 }),
      ),
    ).toEqual([]);
    expect(
      activeEscalationStages(inputs({ peakPower: ESCALATION_NOTICED_POWER })),
    ).toEqual(["NOTICED"]);
  });

  it("HARDENING fires at the OVERMIND_WARNING_THRESHOLD share band, not below it", () => {
    expect(
      activeEscalationStages(
        inputs({ overmindShare: WARNING - 0.001, arcStatus: "advancing" }),
      ),
    ).toEqual([]);
    expect(
      activeEscalationStages(
        inputs({ overmindShare: WARNING, arcStatus: "advancing" }),
      ),
    ).toEqual(["HARDENING"]);
  });

  it("FINAL_PUSH fires only when the arc is contained (pushed back below the contained line)", () => {
    expect(activeEscalationStages(inputs({ arcStatus: "advancing" }))).toEqual(
      [],
    );
    expect(activeEscalationStages(inputs({ arcStatus: "contained" }))).toEqual([
      "FINAL_PUSH",
    ]);
  });

  it("terminal arc statuses suppress every stage (the run is already decided)", () => {
    const all = inputs({
      peakPower: 1,
      overmindShare: 0.9,
      arcStatus: "won",
    });
    expect(activeEscalationStages(all)).toEqual([]);
    expect(activeEscalationStages({ ...all, arcStatus: "lost" })).toEqual([]);
  });

  it("emits multiple crossed stages in escalation order", () => {
    const crossed = activeEscalationStages(
      inputs({ peakPower: 1, overmindShare: WARNING, arcStatus: "contained" }),
    );
    expect(crossed).toEqual(["NOTICED", "HARDENING", "FINAL_PUSH"]);
    expect(crossed).toEqual([...ESCALATION_STAGES]);
  });

  it("is pure: same inputs, same result; inputs not mutated", () => {
    const frozen = Object.freeze(
      inputs({ peakPower: 0.5, overmindShare: 0.4, arcStatus: "advancing" }),
    );
    const a = activeEscalationStages(frozen);
    const b = activeEscalationStages(frozen);
    expect(a).toEqual(b);
  });

  it("honours a custom config (levers stay tunable in balance.ts)", () => {
    const cfg = { noticedPower: 0.5, hardeningShare: 0.6 };
    expect(activeEscalationStages(inputs({ peakPower: 0.4 }), cfg)).toEqual([]);
    expect(activeEscalationStages(inputs({ peakPower: 0.5 }), cfg)).toEqual([
      "NOTICED",
    ]);
    expect(
      activeEscalationStages(
        inputs({ overmindShare: 0.6, arcStatus: "advancing" }),
        cfg,
      ),
    ).toEqual(["HARDENING"]);
  });
});

describe("EscalationNoticeTracker (fire-once)", () => {
  it("fires a stage exactly once when it crosses between observations", () => {
    const tracker = new EscalationNoticeTracker();
    expect(tracker.observe("g1", inputs())).toEqual([]); // baseline seed
    expect(
      tracker.observe("g1", inputs({ peakPower: ESCALATION_NOTICED_POWER })),
    ).toEqual(["NOTICED"]);
    expect(tracker.observe("g1", inputs({ peakPower: 1 }))).toEqual([]); // already fired — never repeats
  });

  it("seeds silently on the first observation of a run (loaded mid-game save does not spam)", () => {
    const tracker = new EscalationNoticeTracker();
    const midGame = inputs({
      peakPower: 1,
      overmindShare: WARNING,
      arcStatus: "advancing",
    });
    expect(tracker.observe("g1", midGame)).toEqual([]); // pre-crossed ⇒ silent
    expect(tracker.observe("g1", midGame)).toEqual([]);
    expect(
      tracker.observe("g1", { ...midGame, arcStatus: "contained" }),
    ).toEqual(["FINAL_PUSH"]);
  });

  it("a stage whose condition lapses and re-crosses does not re-fire", () => {
    const tracker = new EscalationNoticeTracker();
    tracker.observe("g1", inputs());
    expect(
      tracker.observe(
        "g1",
        inputs({ overmindShare: WARNING, arcStatus: "advancing" }),
      ),
    ).toEqual(["HARDENING"]);
    tracker.observe("g1", inputs({ overmindShare: 0.1 }));
    expect(
      tracker.observe(
        "g1",
        inputs({ overmindShare: WARNING + 0.1, arcStatus: "advancing" }),
      ),
    ).toEqual([]);
  });

  it("a different galaxy key resets the tracker (no cross-run leak)", () => {
    const tracker = new EscalationNoticeTracker();
    tracker.observe("g1", inputs());
    expect(tracker.observe("g1", inputs({ peakPower: 1 }))).toEqual([
      "NOTICED",
    ]);
    expect(tracker.observe("g2", inputs())).toEqual([]);
    expect(tracker.observe("g2", inputs({ peakPower: 1 }))).toEqual([
      "NOTICED",
    ]);
  });

  it("multiple stages crossing on the same observation all fire, in order", () => {
    const tracker = new EscalationNoticeTracker();
    tracker.observe("g1", inputs());
    expect(
      tracker.observe(
        "g1",
        inputs({
          peakPower: 1,
          overmindShare: WARNING,
          arcStatus: "contained",
        }),
      ),
    ).toEqual(["NOTICED", "HARDENING", "FINAL_PUSH"]);
  });
});
