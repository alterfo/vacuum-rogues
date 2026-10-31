import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "../../..");
const PRESENTATION_ROOT = resolve(PROJECT_ROOT, "src/presentation");

const MIGRATED_FILES = [
  "InventoryScene.ts",
  "ResearchUpgradePanel.ts",
  "GovernmentScene.ts",
  "RaceSelectionScene.ts",
  "NpcContactPanel.ts",
  "DialogueScene.ts",
  "WinScene.ts",
  "MainMenuScene.ts",
  "SystemMiniMap.ts",
] as const;

const RAW_FONT_SIZE_ALLOWLIST = new Set(["ui/UiButton.ts", "ui/scaledText.ts"]);

function sourceFor(relativePath: string): string {
  return readFileSync(resolve(PRESENTATION_ROOT, relativePath), "utf8");
}

describe("Task 3 typography completion ratchet", () => {
  it("keeps the remaining panel files off raw fontSize style declarations", () => {
    for (const relativePath of MIGRATED_FILES) {
      const source = sourceFor(relativePath);
      expect(
        source,
        `${relativePath} should route dark-panel text through scaledText`,
      ).toContain('from "./ui/scaledText"');
      expect(
        source,
        `${relativePath} still declares style.fontSize directly`,
      ).not.toMatch(/fontSize\s*:/);
    }
  });

  it("keeps the direct-style allowlist narrow and alive", () => {
    expect(RAW_FONT_SIZE_ALLOWLIST.size).toBe(2);
    for (const relativePath of RAW_FONT_SIZE_ALLOWLIST) {
      expect(
        sourceFor(relativePath),
        `allowlisted direct-style module ${relativePath} is missing`,
      ).toContain("fontSize");
    }
  });
});
