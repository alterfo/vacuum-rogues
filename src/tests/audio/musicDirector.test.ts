import { describe, it, expect } from "vitest";
import {
  MusicDirector,
  sceneTrack,
  COMBAT_HOLD_MS,
  type MusicContext,
} from "@/systems/audio/musicDirector";
import { SceneType } from "@/types";

function ctx(partial: Partial<MusicContext>): MusicContext {
  return {
    inCombat: false,
    scene: SceneType.SPACE_FLIGHT,
    now: 0,
    ...partial,
  };
}

describe("musicDirector — sceneTrack", () => {
  it("maps each scene to its ambient track (mirrors playSceneTrack)", () => {
    expect(sceneTrack(SceneType.MAIN_MENU)).toBe("menu_main");
    expect(sceneTrack(SceneType.RACE_SELECTION)).toBe("menu_main");
    expect(sceneTrack(SceneType.STAR_MAP)).toBe("explore_calm");
    expect(sceneTrack(SceneType.SPACE_FLIGHT)).toBe("explore_calm");
    expect(sceneTrack(SceneType.INFO_CENTER)).toBe("explore_calm");
    expect(sceneTrack(SceneType.PLANET)).toBe("planet_hub");
    expect(sceneTrack(SceneType.TRADE)).toBe("market");
    expect(sceneTrack(SceneType.EQUIPMENT_SHOP)).toBe("equipment_shop");
    expect(sceneTrack(SceneType.STATION)).toBe("equipment_shop");
    expect(sceneTrack(SceneType.GOVERNMENT)).toBe("governor_dialogue");
    expect(sceneTrack(SceneType.TEXT_QUEST)).toBe("text_quest");
  });

  it("returns null for overlay scenes that keep the current track", () => {
    expect(sceneTrack(SceneType.DIALOGUE)).toBeNull();
    expect(sceneTrack(SceneType.INVENTORY)).toBeNull();
    expect(sceneTrack(SceneType.BANK)).toBeNull();
    expect(sceneTrack(SceneType.SAVE_LOAD)).toBeNull();
    expect(sceneTrack(SceneType.WIN_SCREEN)).toBeNull();
    expect(sceneTrack(SceneType.GAME_OVER)).toBeNull();
  });
});

describe("musicDirector — desiredTrack ambient", () => {
  it("plays the scene track when nothing tense is happening", () => {
    const d = new MusicDirector();
    expect(d.desiredTrack(ctx({ scene: SceneType.SPACE_FLIGHT }))).toBe(
      "explore_calm",
    );
    expect(d.desiredTrack(ctx({ scene: SceneType.PLANET }))).toBe("planet_hub");
    expect(d.desiredTrack(ctx({ scene: SceneType.TRADE }))).toBe("market");
  });

  it("low hull in flight raises a tension cue (not in shops)", () => {
    const d = new MusicDirector();
    expect(
      d.desiredTrack(ctx({ scene: SceneType.SPACE_FLIGHT, lowHull: true })),
    ).toBe("tension_low");
    // Low hull while docked/trading still plays the scene's track.
    expect(d.desiredTrack(ctx({ scene: SceneType.TRADE, lowHull: true }))).toBe(
      "market",
    );
  });
});

describe("musicDirector — combat transitions", () => {
  it("switches to combat the moment a fight engages", () => {
    const d = new MusicDirector();
    expect(d.desiredTrack(ctx({ inCombat: false, now: 0 }))).toBe(
      "explore_calm",
    );
    expect(d.desiredTrack(ctx({ inCombat: true, now: 10 }))).toBe("combat");
  });

  it("uses the boss track for boss fights", () => {
    const d = new MusicDirector();
    expect(d.desiredTrack(ctx({ inCombat: true, boss: true, now: 0 }))).toBe(
      "combat_boss",
    );
  });

  it("returns to ambient only after the combat-hold window elapses", () => {
    const d = new MusicDirector();
    // Engage at t=0.
    expect(d.desiredTrack(ctx({ inCombat: true, now: 0 }))).toBe("combat");
    // Disengage — still held within the window.
    expect(
      d.desiredTrack(ctx({ inCombat: false, now: COMBAT_HOLD_MS - 1 })),
    ).toBe("combat");
    // Past the window — reverts to ambient.
    expect(
      d.desiredTrack(ctx({ inCombat: false, now: COMBAT_HOLD_MS + 1 })),
    ).toBe("explore_calm");
  });

  it("debounces a brief skirmish so it never flaps back to ambient", () => {
    const d = new MusicDirector();
    const sequence: (string | null)[] = [];
    // Rapid engage/disengage toggles, each well within the hold window.
    for (let i = 0; i < 6; i++) {
      sequence.push(
        d.desiredTrack(ctx({ inCombat: i % 2 === 0, now: i * 100 })),
      );
    }
    // Every tick stays on combat — no flap to ambient mid-skirmish.
    expect(sequence.every((t) => t === "combat")).toBe(true);
  });

  it("does not play combat music outside flight scenes", () => {
    const d = new MusicDirector();
    // A station scene never enters combat: the inCombat flag is ignored there.
    expect(
      d.desiredTrack(ctx({ inCombat: true, scene: SceneType.STATION, now: 0 })),
    ).toBe("equipment_shop");
  });

  it("only fires a distinct track on real state changes", () => {
    const d = new MusicDirector();
    const distinct: (string | null)[] = [];
    const push = (c: Partial<MusicContext>) => {
      const t = d.desiredTrack(ctx(c));
      if (distinct.length === 0 || distinct[distinct.length - 1] !== t) {
        distinct.push(t);
      }
    };
    push({ inCombat: false, now: 0 }); // explore_calm
    push({ inCombat: false, now: 100 }); // explore_calm (no change)
    push({ inCombat: true, now: 200 }); // combat
    push({ inCombat: true, now: 300 }); // combat (no change)
    push({ inCombat: false, now: 400 }); // combat (held)
    push({ inCombat: false, now: 400 + COMBAT_HOLD_MS + 1 }); // explore_calm
    expect(distinct).toEqual(["explore_calm", "combat", "explore_calm"]);
  });
});

describe("musicDirector — reset", () => {
  it("clears the combat hold so ambient resumes immediately", () => {
    const d = new MusicDirector();
    expect(d.desiredTrack(ctx({ inCombat: true, now: 0 }))).toBe("combat");
    d.reset();
    expect(d.desiredTrack(ctx({ inCombat: false, now: 1 }))).toBe(
      "explore_calm",
    );
  });
});
