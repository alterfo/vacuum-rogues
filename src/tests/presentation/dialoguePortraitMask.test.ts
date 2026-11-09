import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "../../presentation/DialogueScene.ts");
const source = readFileSync(SOURCE, "utf8");

describe("DialogueScene portrait mask (PixiJS 8 rule)", () => {
  it("parents the mask under the masked surface before assigning it", () => {
    expect(source).toMatch(
      /portraitSurface\.addChild\(portraitMask\);\s*portraitSurface\.addChild\(portraitSprite\);\s*portraitSurface\.mask = portraitMask;/,
    );
  });

  it("never assigns the mask to the bare sprite", () => {
    expect(source).not.toMatch(/portraitSprite\.mask\s*=/);
  });
});
