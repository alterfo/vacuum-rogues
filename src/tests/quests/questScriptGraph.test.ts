import { describe, it, expect } from "vitest";
import { ALL_QUEST_SCRIPTS } from "@/systems/quests/TextQuestRegistry";
import type { QuestScript } from "@/systems/quests/QuestScript";

function reachableLocationIds(script: QuestScript): Set<string> {
  const byId = new Map(script.locations.map((l) => [l.id, l]));
  const critTargets = script.params
    .map((p) => p.critTarget)
    .filter((t): t is string => !!t);
  const seen = new Set<string>();
  const queue = [script.startLocation, ...critTargets];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const loc = byId.get(id);
    if (!loc) continue;
    for (const t of loc.transitions) {
      if (!seen.has(t.toLocation)) queue.push(t.toLocation);
    }
  }
  return seen;
}

function locationTexts(loc: QuestScript["locations"][number]): string[] {
  return typeof loc.text === "string" ? [loc.text] : loc.text;
}

function referencedPlaceholders(script: QuestScript): string[] {
  const out: string[] = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  for (const loc of script.locations) {
    for (const src of [
      ...locationTexts(loc),
      ...loc.transitions.map((t) => t.label),
    ]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) out.push(m[1]);
    }
  }
  return out;
}

function parseEffect(
  effect: string,
): { target: string; op: string; rhs: string } | null {
  const m = effect.trim().match(/^([a-zA-Z0-9_]+)\s*(\+=|-=|=)\s*(.+)$/);
  if (!m) return null;
  return { target: m[1], op: m[2], rhs: m[3].trim() };
}

describe("Quest script graph invariants (all 12 scripts)", () => {
  it("covers the full registry", () => {
    expect(ALL_QUEST_SCRIPTS.length).toBeGreaterThanOrEqual(12);
  });

  for (const script of ALL_QUEST_SCRIPTS) {
    describe(`${script.id}`, () => {
      const paramIds = new Set(script.params.map((p) => p.id));
      const locIds = new Set(script.locations.map((l) => l.id));

      it("start location exists", () => {
        expect(locIds.has(script.startLocation)).toBe(true);
      });

      it("location ids are unique", () => {
        expect(locIds.size).toBe(script.locations.length);
      });

      it("has no unreachable locations", () => {
        const reachable = reachableLocationIds(script);
        const unreachable = script.locations
          .map((l) => l.id)
          .filter((id) => !reachable.has(id));
        expect(unreachable).toEqual([]);
      });

      it("every transition points at a real location", () => {
        for (const loc of script.locations) {
          for (const t of loc.transitions) {
            expect(locIds.has(t.toLocation)).toBe(true);
          }
        }
      });

      it("every critTarget points at a real location", () => {
        for (const p of script.params) {
          if (p.critTarget) expect(locIds.has(p.critTarget)).toBe(true);
        }
      });

      it("has at least one success and one failure terminal", () => {
        expect(script.locations.some((l) => l.isSuccess)).toBe(true);
        expect(script.locations.some((l) => l.isFailure)).toBe(true);
      });

      it("no terminal is marked both success and failure", () => {
        for (const l of script.locations) {
          expect(l.isSuccess && l.isFailure).toBeFalsy();
        }
      });

      it("every success/failure terminal reachable and dead-ends", () => {
        const reachable = reachableLocationIds(script);
        for (const l of script.locations) {
          if (l.isSuccess || l.isFailure) {
            expect(reachable.has(l.id)).toBe(true);
            expect(l.transitions.length).toBe(0);
          }
        }
      });

      it("every interpolation placeholder resolves to a declared param", () => {
        for (const token of referencedPlaceholders(script)) {
          expect(paramIds.has(token)).toBe(true);
        }
      });

      it("every effect targets a declared param", () => {
        for (const loc of script.locations) {
          for (const t of loc.transitions) {
            for (const eff of t.effects) {
              const parsed = parseEffect(eff);
              expect(parsed, `unparseable effect "${eff}"`).not.toBeNull();
              expect(paramIds.has(parsed!.target)).toBe(true);
            }
          }
        }
      });

      it("constant meter effects stay within param bounds", () => {
        const byParam = new Map(script.params.map((p) => [p.id, p]));
        for (const loc of script.locations) {
          for (const t of loc.transitions) {
            for (const eff of t.effects) {
              const parsed = parseEffect(eff);
              if (!parsed) continue;
              const p = byParam.get(parsed.target)!;
              const rand = parsed.rhs.match(
                /^random\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/,
              );
              if (parsed.op === "=" && rand) {
                const lo = Number(rand[1]);
                const hi = Number(rand[2]);
                expect(lo).toBeGreaterThanOrEqual(p.min);
                expect(hi).toBeLessThanOrEqual(p.max);
                expect(lo).toBeLessThanOrEqual(hi);
              }
              if (parsed.op !== "=") {
                const numeric = /^-?\d+$/.test(parsed.rhs);
                expect(numeric || paramIds.has(parsed.rhs)).toBe(true);
              }
            }
          }
        }
      });

      it("every non-terminal, non-auto location offers a choice or auto-advance", () => {
        for (const l of script.locations) {
          if (l.isSuccess || l.isFailure) continue;
          expect(l.transitions.length).toBeGreaterThan(0);
        }
      });
    });
  }
});
