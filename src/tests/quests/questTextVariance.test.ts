import { describe, it, expect } from "vitest";
import {
  QuestVM,
  questTextHash,
  resolveLocationText,
} from "@/systems/quests/QuestVM";
import type { QuestScript } from "@/systems/quests/QuestScript";

const POOL = ["Вариант А", "Вариант Б", "Вариант В", "Вариант Г"];

function rollScript(startText: string | string[]): QuestScript {
  return {
    id: "variance_probe",
    title: "Variance probe",
    params: [
      {
        id: "roll",
        name: "roll",
        min: 0,
        max: 1000,
        initial: 0,
        showInUI: false,
      },
    ],
    startLocation: "start",
    locations: [
      {
        id: "start",
        text: startText,
        transitions: [
          {
            id: "go",
            label: "go",
            toLocation: "done",
            effects: ["roll = random(0,1000)"],
          },
        ],
      },
      { id: "done", text: "done", isSuccess: true, transitions: [] },
    ],
  };
}

describe("Task 14 — quest text-pool variance resolver", () => {
  describe("resolveLocationText (pure)", () => {
    it("returns a scalar text verbatim", () => {
      expect(resolveLocationText("hello", "seed", "loc")).toBe("hello");
    });

    it("picks a member of the pool", () => {
      const picked = resolveLocationText(POOL, "seed-1", "start");
      expect(POOL).toContain(picked);
    });

    it("is deterministic for the same (seed, locationId)", () => {
      const a = resolveLocationText(POOL, "seed-1", "start");
      const b = resolveLocationText(POOL, "seed-1", "start");
      expect(a).toBe(b);
    });

    it("varies across seeds (not every seed collapses to one variant)", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(resolveLocationText(POOL, `seed-${i}`, "start"));
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it("varies across location ids under the same seed", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(resolveLocationText(POOL, "fixed-seed", `loc-${i}`));
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it("resolves an empty pool to an empty string", () => {
      expect(resolveLocationText([], "seed", "loc")).toBe("");
    });

    it("resolves a single-element pool to that element", () => {
      expect(resolveLocationText(["only"], "seed", "loc")).toBe("only");
    });
  });

  describe("questTextHash (pure)", () => {
    it("is deterministic and returns a non-negative 32-bit integer", () => {
      const h = questTextHash("seed:start");
      expect(h).toBe(questTextHash("seed:start"));
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    });

    it("differs for different keys", () => {
      expect(questTextHash("a:b")).not.toBe(questTextHash("a:c"));
    });
  });

  describe("QuestVM.currentLocationText", () => {
    it("resolves a scalar location text", () => {
      const vm = new QuestVM(rollScript("plain"), "seed");
      expect(vm.currentLocationText()).toBe("plain");
    });

    it("is deterministic per seed and varies across seeds", () => {
      const same = new QuestVM(
        rollScript(POOL),
        "seed-A",
      ).currentLocationText();
      const sameAgain = new QuestVM(
        rollScript(POOL),
        "seed-A",
      ).currentLocationText();
      expect(sameAgain).toBe(same);

      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) {
        seen.add(
          new QuestVM(rollScript(POOL), `seed-${i}`).currentLocationText(),
        );
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it("does NOT consume the RNG stream (pool vs scalar roll identically)", () => {
      const scalarVm = new QuestVM(rollScript("plain"), "seed-XYZ");
      scalarVm.currentLocationText();
      scalarVm.execute("go");

      const poolVm = new QuestVM(rollScript(POOL), "seed-XYZ");
      poolVm.currentLocationText();
      poolVm.execute("go");

      expect(poolVm.getParam("roll")).toBe(scalarVm.getParam("roll"));
    });
  });
});
