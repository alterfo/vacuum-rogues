import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../../presentation/RaceSelectionScene.ts");
const source = readFileSync(SOURCE, "utf8");

describe("RaceSelectionScene portrait mask (PixiJS 8 rule)", () => {
  it("parents the mask under the masked surface before assigning it", () => {
    expect(source).toMatch(
      /surface\.addChild\(mask\);\s*surface\.addChild\(sprite\);\s*surface\.mask = mask;/,
    );
  });

  it("never assigns the mask to the bare sprite", () => {
    expect(source).not.toMatch(/sprite\.mask\s*=/);
  });
});
