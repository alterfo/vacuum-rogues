import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findCyrillicLiterals } from "@/i18n/cyrillicLiterals";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const MIGRATED_SCENES = [
  "src/presentation/MainMenuScene.ts",
  "src/presentation/TradeScene.ts",
  "src/presentation/JobBoardPanel.ts",
  "src/presentation/NpcContactPanel.ts",
  "src/presentation/ui/SettingsPanel.ts",
  "src/presentation/ui/HelpPanel.ts",
  "src/systems/onboarding/helpContent.ts",
  "src/presentation/RaceSelectionScene.ts",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(PROJECT_ROOT, rel), "utf8");
}

describe("migrated scenes hold no inline Cyrillic literals", () => {
  for (const file of MIGRATED_SCENES) {
    it(`${file} renders keys, not literals`, () => {
      const hits = findCyrillicLiterals(read(file), file);
      const preview = hits
        .map((h) => `${h.line}: ${h.text.slice(0, 40)}`)
        .join("\n");
      expect(hits, `inline Cyrillic literal(s) remain:\n${preview}`).toEqual(
        [],
      );
    });

    it(`${file} actually routes text through the i18n layer`, () => {
      expect(read(file)).toMatch(/\bt\(/);
    });
  }
});
