/**
 * Task 3 (route the panels through `scaledText`). The Job Board was the
 * screenshot offender: its body description (`0x889aaa`), footer hint
 * (`0x668899`) and issuer line (`0x77aacc`) were dim blue-grays at a fixed 9–11px
 * that ignored the S/M/L setting and were hard to read on the dark panel.
 *
 * After routing through `scaledText` this pins the new contract:
 *  - neutral/dim text tracks the font-scale setting (`scaledFont(base)`), and
 *    is lifted to the readability floor (no more sub-AA blue-gray), while
 *  - semantic accent colors (type tag, reward gold) pass through verbatim.
 *
 * Real PixiJS nodes construct in jsdom (style inspection needs no renderer).
 */
import { describe, it, expect, afterEach } from "vitest";
import { Container, Text } from "pixi.js";
import { JobBoardPanel } from "@/presentation/JobBoardPanel";
import { setFontScale, scaledFont } from "@/utils/fontScale";
import {
  relativeLuminance,
  READABLE_FLOOR,
} from "@/presentation/ui/scaledText";
import { QuestType } from "@/types";
import type { GeneratedQuest } from "@/systems/quests/QuestGenerator";
import type { QuestTemplate } from "@/systems/QuestManager";

afterEach(() => setFontScale("M")); // never leak a scale into other tests

const FLOOR_LUM = relativeLuminance(READABLE_FLOOR);

const DESCRIPTION = "Срочный груз медикаментов доставить в систему Альфа.";

function makeQuest(): GeneratedQuest {
  const template = {
    id: "q1",
    title: "Доставить медикаменты",
    description: DESCRIPTION,
    type: QuestType.DELIVERY,
    reward: { credits: 500, experience: 0, items: [] },
    failurePenalty: null,
    objectives: [],
    deadline: 0,
    minReputation: 0,
    minRank: 0,
  } as unknown as QuestTemplate;
  return {
    template,
    jumps: 1,
    issuerName: "Маклай",
    issuerTitle: "Снабженец",
    targetNpcName: null,
    highlights: [],
    issuerPlanetId: "planet-1",
  } as unknown as GeneratedQuest;
}

function collectTexts(node: Container): Text[] {
  const out: Text[] = [];
  const visit = (n: Container): void => {
    if (n instanceof Text) out.push(n);
    for (const c of (n.children ?? []) as Container[]) visit(c);
  };
  visit(node);
  return out;
}

function buildPanel(): JobBoardPanel {
  return new JobBoardPanel([makeQuest()], 800, 600, {
    onAccept: () => {},
    onClose: () => {},
  });
}

function findText(panel: JobBoardPanel, pred: (t: Text) => boolean): Text {
  const match = collectTexts(panel.container).find(pred);
  expect(match, "expected a matching Text node").toBeTruthy();
  return match!;
}

describe("JobBoardPanel routes text through scaledText", () => {
  it("scales the body description with the S/M/L setting", () => {
    setFontScale("S");
    const small = findText(buildPanel(), (t) => t.text === DESCRIPTION).style
      .fontSize as number;
    const expectedS = scaledFont(10);
    setFontScale("M");
    const med = findText(buildPanel(), (t) => t.text === DESCRIPTION).style
      .fontSize as number;
    const expectedM = scaledFont(10);
    setFontScale("L");
    const large = findText(buildPanel(), (t) => t.text === DESCRIPTION).style
      .fontSize as number;
    const expectedL = scaledFont(10);

    expect(small).toBe(expectedS);
    expect(med).toBe(expectedM);
    expect(large).toBe(expectedL);
    expect(small).toBeLessThan(med);
    expect(med).toBeLessThan(large);
  });

  it("lifts the dim body + issuer blue-grays to the readability floor", () => {
    const panel = buildPanel();
    const desc = findText(panel, (t) => t.text === DESCRIPTION);
    const issuer = findText(panel, (t) => t.text.includes("Снабженец"));

    for (const node of [desc, issuer]) {
      const fill = node.style.fill as number;
      expect(relativeLuminance(fill)).toBeGreaterThanOrEqual(FLOOR_LUM);
    }
    // The original dim values are no longer used verbatim.
    expect(desc.style.fill).not.toBe(0x889aaa);
    expect(issuer.style.fill).not.toBe(0x77aacc);
  });

  it("passes semantic accent colors through verbatim", () => {
    const panel = buildPanel();
    // Reward gold and the DELIVERY type tag are deliberate accents, not dim
    // text — they must keep their hue (rawColor), only the font scales.
    const reward = findText(panel, (t) => t.text.startsWith("💰"));
    const typeTag = findText(panel, (t) => t.text === "Доставка");
    expect(reward.style.fill).toBe(0xffe27a);
    expect(typeTag.style.fill).toBe(0x88ccff);
  });
});
