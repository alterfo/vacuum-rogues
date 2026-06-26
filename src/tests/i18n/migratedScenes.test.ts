/**
 * Migrated-scenes guard (`docs/plans/20260625-localization-i18n.md`, Task 3).
 *
 * The "no untranslated literal in migrated scenes" lint: every file listed in
 * {@link MIGRATED_SCENES} has had its player-facing Russian literals moved onto
 * `t(...)` keys, so it must contain **zero inline Cyrillic string literals**
 * (comments are skipped — Russian prose there is fine). This is the coverage
 * test the plan describes: it **grows** as scenes migrate (add the file here),
 * and it prevents backsliding (a re-added Cyrillic literal reds the gate).
 *
 * It reuses the shared scanner core `findCyrillicLiterals` (the same one the
 * `tools/i18n/extract.ts` migration tracker runs), so "migrated" means exactly
 * "the tracker reports nothing for this file".
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findCyrillicLiterals } from "@/i18n/cyrillicLiterals";

/** Project root — three levels up from `src/tests/i18n/`. */
const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * Scenes whose UI literals have been migrated to `t(...)` keys (Task 3). Append
 * to this list as further scenes migrate — the guard then enforces them too.
 */
const MIGRATED_SCENES = [
  "src/presentation/MainMenuScene.ts",
  "src/presentation/TradeScene.ts",
  "src/presentation/JobBoardPanel.ts",
  "src/presentation/NpcContactPanel.ts",
  "src/presentation/ui/SettingsPanel.ts",
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
      // A migrated scene must call `t(` — guards against a "cleared by deleting
      // the text" false pass.
      expect(read(file)).toMatch(/\bt\(/);
    });
  }
});
