/**
 * Onboarding help COVERAGE + ACCURACY (Task 3 of
 * `docs/plans/20260627-screen-consistency-onboarding.md`).
 *
 * Two guards over the pure help registry (no PixiJS):
 *   • Coverage — every gameplay `SceneType` (i.e. every scene EXCEPT the
 *     intentional terminal/menu omissions) has a `HELP_CONTENT` entry, so a new
 *     gameplay scene can't silently ship without onboarding text. The omission
 *     set is asserted exhaustive, so adding a scene forces a deliberate choice.
 *   • Accuracy — the planet Верфь (`EQUIPMENT_SHOP`) help describes its REAL
 *     capabilities at that entry point: all three tabs (Снаряжение / Корпус /
 *     Ангар), including the hull trade-in the older copy never mentioned.
 */
import { describe, expect, it } from "vitest";
import { SceneType } from "@/types";
import {
  HELP_CONTENT,
  HELP_SPEC,
  helpFor,
  type HelpKey,
} from "@/systems/onboarding/helpContent";

/**
 * Scenes that intentionally omit contextual help: terminal screens (win/lose)
 * and menu/transition surfaces. Kept in sync with the plan's Context note
 * ("GameOver/Win/MainMenu/SaveLoad/Dialogue intentionally omit it").
 */
const HELP_OMITTED_SCENES: ReadonlySet<SceneType> = new Set([
  SceneType.MAIN_MENU,
  SceneType.DIALOGUE,
  SceneType.WIN_SCREEN,
  SceneType.GAME_OVER,
  SceneType.SAVE_LOAD,
]);

describe("onboarding help coverage", () => {
  it("every gameplay SceneType has a HELP_CONTENT entry", () => {
    const missing = Object.values(SceneType)
      .filter((scene) => !HELP_OMITTED_SCENES.has(scene))
      .filter((scene) => !(scene in HELP_CONTENT));
    expect(
      missing,
      `gameplay scenes missing onboarding help:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("each gameplay HelpKey is a real, non-omitted SceneType (no dead scene keys)", () => {
    const sceneKeys = (Object.keys(HELP_SPEC) as HelpKey[]).filter(
      (k): k is HelpKey & SceneType =>
        (Object.values(SceneType) as string[]).includes(k),
    );
    for (const key of sceneKeys) {
      expect(HELP_OMITTED_SCENES.has(key as unknown as SceneType)).toBe(false);
    }
  });

  it("the omission set is exhaustive (adding a scene forces a coverage choice)", () => {
    // Every omitted scene is a real SceneType — guards against a stale entry.
    for (const scene of HELP_OMITTED_SCENES) {
      expect(Object.values(SceneType)).toContain(scene);
    }
  });
});

describe("onboarding help accuracy — planet Верфь (EQUIPMENT_SHOP)", () => {
  it("documents all three tabs, one control per tab", () => {
    const entry = helpFor("EQUIPMENT_SHOP");
    expect(entry.controls).toHaveLength(3);
    const text = [entry.title, ...entry.body, ...(entry.controls ?? [])]
      .join(" ")
      .toLowerCase();
    // The three real tab labels from EquipmentShopScene.renderTabs:
    // [ СНАРЯЖЕНИЕ ] / [ КОРПУС ] / [ АНГАР ].
    expect(text).toContain("снаряжение");
    expect(text).toContain("корпус");
    expect(text).toContain("ангар");
  });

  it("mentions the hull trade-in capability the planet shop actually offers", () => {
    const entry = helpFor("EQUIPMENT_SHOP");
    const text = [...entry.body, ...(entry.controls ?? [])]
      .join(" ")
      .toLowerCase();
    // The КОРПУС tab buys a new hull crediting the old one (buyHullWithTradeIn).
    expect(text).toContain("зачёт");
  });
});
