import { describe, it, expect } from "vitest";
import type { QuestScript } from "@/systems/quests/QuestScript";
import { cargoSortScript } from "@/systems/quests/scripts/cargo-sort";
import { signalDecodeScript } from "@/systems/quests/scripts/signal-decode";
import { gravitySlalomScript } from "@/systems/quests/scripts/gravity-slalom";
import { reactorScript } from "@/systems/quests/scripts/reactor";
import { derelictSalvageScript } from "@/systems/quests/scripts/derelict-salvage";

function allStrings(script: QuestScript): string[] {
  const out: string[] = [];
  for (const loc of script.locations) {
    if (typeof loc.text === "string") out.push(loc.text);
    else out.push(...loc.text);
    for (const t of loc.transitions) out.push(t.label);
  }
  return out;
}

function scriptContains(script: QuestScript, needle: string): boolean {
  return allStrings(script).some((s) => s.includes(needle));
}

describe("Task 3 — quest text/content fixes", () => {
  it("cargo-sort: dock params read «Док», never the «Дог» typo", () => {
    const names = cargoSortScript.params.map((p) => p.name);
    expect(names.some((n) => n.includes("Дог"))).toBe(false);
    expect(names).toContain("Док 1 (ч)");
    expect(names).toContain("Док 2 (ч)");
    expect(names).toContain("Док 3 (ч)");
  });

  it("signal-decode: no «коротая»/«Влобовой» typos", () => {
    expect(scriptContains(signalDecodeScript, "коротая")).toBe(false);
    expect(scriptContains(signalDecodeScript, "Влобовой")).toBe(false);
    expect(scriptContains(signalDecodeScript, "короткая")).toBe(true);
    expect(scriptContains(signalDecodeScript, "Лобовой")).toBe(true);
  });

  it("gravity-slalom: praise ending no longer shakes the head in disapproval", () => {
    expect(scriptContains(gravitySlalomScript, "качает головой")).toBe(false);
  });

  it("reactor: no «...» placeholder labels reach the data, station is named", () => {
    for (const loc of reactorScript.locations) {
      for (const t of loc.transitions) {
        expect(t.label).not.toBe("...");
      }
    }
    expect(scriptContains(reactorScript, "«Горнило»")).toBe(true);
  });

  it("derelict-salvage: no «...» placeholder labels reach the data", () => {
    for (const loc of derelictSalvageScript.locations) {
      for (const t of loc.transitions) {
        expect(t.label).not.toBe("...");
      }
    }
  });
});
