import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "../../..");
const SOURCE = resolve(PROJECT_ROOT, "src/presentation/StarMapScene.ts");

const source = readFileSync(SOURCE, "utf8");

describe("StarMapScene typography migration (Task 1)", () => {
  it("has no raw fontSize: text styles left", () => {
    expect(source).not.toMatch(/fontSize\s*:/);
  });

  it("routes text through scaledText", () => {
    expect(source).toContain('from "./ui/scaledText"');
    expect(source).toContain("scaledText(");
  });

  it("keeps the lightened unvisited/neighbor label color (no 0x445566 regression)", () => {
    expect(source).not.toContain("0x445566");
  });
});
