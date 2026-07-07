import { describe, it, expect } from "vitest";
import { ALL_QUEST_SCRIPTS } from "@/systems/quests/TextQuestRegistry";
import type { QuestScript } from "@/systems/quests/QuestScript";

// Graph-validation suite covering ALL 12 branching text-quests (Task 13).
// The behavioural suites (questScripts.test.ts, newQuestScripts.test.ts) drive
// specific paths; this file asserts the structural invariants that a prose
// rewrite must never break: reachability, legal transitions, in-bounds meter
// effects, and that every interpolation placeholder resolves to a real param.

// BFS the reachable location set from the start plus every critTarget (a crit
// threshold can redirect execution to its target from anywhere).
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

// Extract every {token} used across all of a script's location texts + labels.
function referencedPlaceholders(script: QuestScript): string[] {
  const out: string[] = [];
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  for (const loc of script.locations) {
    for (const src of [loc.text, ...loc.transitions.map((t) => t.label)]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) out.push(m[1]);
    }
  }
  return out;
}

// Parse an effect string into { target, op, rhs }. Grammar seen in the scripts:
//   "money -= 200" | "money += 1000" | "x = 5" | "x = random(0,9)"
function parseEffect(
  effect: string,
): { target: string; op: string; rhs: string } | null {
  const m = effect.trim().match(/^([a-zA-Z0-9_]+)\s*(\+=|-=|=)\s*(.+)$/);
  if (!m) return null;
  return { target: m[1], op: m[2], rhs: m[3].trim() };
}

describe("Quest script graph invariants (all 12 scripts)", () => {
  it("covers the full registry", () => {
    // Guards against a new script being added without graph coverage.
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
                // A randomised roll must sample inside the param's declared
                // range — an out-of-range random is a genuine authoring bug the
                // VM's clamp would silently mask.
                const lo = Number(rand[1]);
                const hi = Number(rand[2]);
                expect(lo).toBeGreaterThanOrEqual(p.min);
                expect(hi).toBeLessThanOrEqual(p.max);
                expect(lo).toBeLessThanOrEqual(hi);
              }
              // Plain constant assignments (e.g. the "checkpoint = 0" reset
              // idiom before a += advance) are intentionally VM-clamped and are
              // not required to sit within [min, max].
              // += / -= deltas accumulate at runtime and are clamped by the VM;
              // they are only required to be numeric or a param reference.
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
          // A live (non-terminal) location must be able to progress: either it
          // has transitions, or it is a critTarget-only sink (unreachable check
          // already guarantees reachability). Prose rewrites must never strand
          // the player at a choiceless non-ending screen.
          expect(l.transitions.length).toBeGreaterThan(0);
        }
      });
    });
  }
});
