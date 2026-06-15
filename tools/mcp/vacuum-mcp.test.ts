/**
 * Smoke tests for the vacuum-mcp tool implementations.
 *
 * These call the tool functions directly (tools.ts), not through the MCP
 * protocol — the protocol layer in vacuum-mcp.ts is a thin wrapper. The goal is
 * to prove each lookup returns the right shape against the real source tree.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findSymbol,
  findTestsFor,
  getArchitecture,
  getBalanceConstants,
  getSceneInfo,
  REPO_ROOT,
} from "./tools";

describe("vacuum-mcp tools", () => {
  describe("findSymbol", () => {
    it("locates QuestType in src/types/index.ts", () => {
      const result = findSymbol("QuestType");
      expect(result).toContain("src/types/index.ts");
    });

    it("locates SceneType in src/types/index.ts", () => {
      expect(findSymbol("SceneType")).toContain("src/types/index.ts");
    });

    it("returns a not-found message for an unknown symbol", () => {
      expect(findSymbol("ZZZNoSuchSymbolZZZ")).toMatch(/no declaration found/);
    });

    it("rejects non-identifier input instead of shelling out", () => {
      expect(findSymbol("foo; rm -rf /")).toMatch(/not a valid identifier/);
    });
  });

  describe("findTestsFor", () => {
    it("returns test files that actually import QuestManager", () => {
      const tests = findTestsFor("src/systems/QuestManager.ts");
      expect(Array.isArray(tests)).toBe(true);
      expect(tests.length).toBeGreaterThan(0);
      // Every result is under src/tests/ (the grep root guarantees that
      // trivially) — so also assert the returned files genuinely reference the
      // symbol, which is the behaviour the tool actually promises.
      const referencesSymbol = tests.some((t) =>
        readFileSync(join(REPO_ROOT, t), "utf8").includes("QuestManager"),
      );
      expect(referencesSymbol).toBe(true);
    });

    it("returns an empty array for an unsafe path", () => {
      expect(findTestsFor("../etc/passwd")).toEqual([]);
    });
  });

  describe("getArchitecture", () => {
    it("returns the static layer map with layers and lockstep rules", () => {
      const arch = getArchitecture() as {
        layers: unknown[];
        lockstep_rules: unknown[];
        key_entry_points: Record<string, unknown>;
      };
      expect(Array.isArray(arch.layers)).toBe(true);
      expect(arch.layers.length).toBeGreaterThan(0);
      expect(Array.isArray(arch.lockstep_rules)).toBe(true);
      expect(arch.key_entry_points["src/systems/GameEngine.ts"]).toBeDefined();
    });
  });

  describe("getBalanceConstants", () => {
    it("returns balance constants with STARTING_MONEY: 1000 at top level", async () => {
      const constants = await getBalanceConstants();
      expect(constants.STARTING_MONEY).toBe(1000);
      // A top-level numeric export is also surfaced.
      expect(constants.QUEST_BASE_REWARD).toBe(400);
    });
  });

  describe("getSceneInfo", () => {
    it("returns lifecycle lines for PlanetScene", () => {
      const info = getSceneInfo("PlanetScene");
      expect(info).toMatch(/initialize/);
      expect(info).toMatch(/update/);
    });

    it("returns a not-found message for an unknown scene", () => {
      expect(getSceneInfo("NoSuchScene")).toMatch(/not found/);
    });
  });
});
