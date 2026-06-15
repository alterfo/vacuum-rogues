/**
 * Tests for the domain-field scaffolder.
 *
 * Each test builds a minimal fixture tree in a temp directory that mirrors the
 * real file layout (src/domain, src/validation, src/data), runs the generator
 * against it, and asserts all three lockstep files are correctly edited. We
 * verify idempotency (running twice does not duplicate anything) and the
 * documented error cases (missing entity, missing schema).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLiteral,
  scaffoldDomainField,
  zodExpr,
} from "./domain-field";

const PLAYER_TS = `import type { FactionType } from "@/types";

export class Player {
  contrabandGoods: string[] = [];
  killPoints: number = 0;

  constructor(
    public readonly id: string,
    public credits: number,
  ) {}

  getReputation(): number {
    return 0;
  }
}
`;

const SCHEMAS_TS = `import { z } from "zod";

export const StationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["A", "B"]).default("A"),
});

export const PlayerSchema = z.object({
  id: z.string().min(1),
  credits: z.number().int().min(0),
  killPoints: z.number().int().min(0).default(0),
  faction: z.enum(["OUTLANDERS", "BASTIONS"]).default("OUTLANDERS"),
});

export const SaveStateSchema = z.object({
  player: PlayerSchema,
});
`;

const MIGRATION_TS = `import type { SaveState } from "@/domain/SaveState";

export class MigrationPipeline {
  static readonly CURRENT_VERSION = 22;

  static migrate(state: SaveState): SaveState {
    return state;
  }

  private static migrations: Record<number, (state: SaveState) => void> = {
    20: (_state: SaveState) => {
      // no-op
    },
    21: (state: SaveState) => {
      const player = state.player as unknown as { foo?: number };
      if (player && player.foo === undefined) player.foo = 0;
    },
  };
}
`;

let root: string;

function writeFixtures(): void {
  mkdirSync(join(root, "src/domain"), { recursive: true });
  mkdirSync(join(root, "src/validation"), { recursive: true });
  mkdirSync(join(root, "src/data"), { recursive: true });
  writeFileSync(join(root, "src/domain/Player.ts"), PLAYER_TS);
  writeFileSync(join(root, "src/validation/schemas.ts"), SCHEMAS_TS);
  writeFileSync(join(root, "src/data/MigrationPipeline.ts"), MIGRATION_TS);
}

const read = (p: string) => readFileSync(join(root, p), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "domain-field-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("defaultLiteral / zodExpr", () => {
  it("renders type defaults", () => {
    expect(defaultLiteral("number", "5")).toBe("5");
    expect(defaultLiteral("number", undefined)).toBe("0");
    expect(defaultLiteral("number", "notanumber")).toBe("0");
    expect(defaultLiteral("boolean", "true")).toBe("true");
    expect(defaultLiteral("boolean", undefined)).toBe("false");
    expect(defaultLiteral("string", "hi")).toBe('"hi"');
    expect(defaultLiteral("string", undefined)).toBe('""');
  });

  it("renders zod expressions", () => {
    expect(zodExpr("number", "0")).toBe("z.number().default(0)");
    expect(zodExpr("boolean", "true")).toBe("z.boolean().default(true)");
    expect(zodExpr("string", "x")).toBe('z.string().default("x")');
  });
});

describe("scaffoldDomainField — happy path", () => {
  it("edits all three lockstep files for a number field", () => {
    writeFixtures();
    const res = scaffoldDomainField(
      { entity: "Player", field: "techResearch", type: "number", default: "0" },
      root,
    );

    expect(res.warnings).toEqual([]);
    expect(res.changed).toEqual(
      expect.arrayContaining([
        "src/domain/Player.ts",
        "src/validation/schemas.ts",
        "src/data/MigrationPipeline.ts",
      ]),
    );

    // 1. domain class — field inserted as a readonly class property
    const player = read("src/domain/Player.ts");
    expect(player).toContain("readonly techResearch: number = 0;");

    // 2. schema — inserted inside PlayerSchema, NOT StationSchema/SaveStateSchema
    const schemas = read("src/validation/schemas.ts");
    expect(schemas).toContain("techResearch: z.number().default(0),");
    const playerBlock = schemas.slice(
      schemas.indexOf("export const PlayerSchema"),
      schemas.indexOf("export const SaveStateSchema"),
    );
    expect(playerBlock).toContain("techResearch:");
    const stationBlock = schemas.slice(0, schemas.indexOf("export const PlayerSchema"));
    expect(stationBlock).not.toContain("techResearch");

    // 3. migration — CURRENT_VERSION bumped, new migration keyed at old version
    const mig = read("src/data/MigrationPipeline.ts");
    expect(mig).toContain("CURRENT_VERSION = 23");
    expect(mig).toContain("22: (state: SaveState) =>");
    expect(mig).toContain("player.techResearch = 0;");

    // a non-empty checklist of manual follow-ups is always returned
    expect(res.checklist.length).toBeGreaterThan(0);
  });

  it("handles boolean and string fields", () => {
    writeFixtures();
    scaffoldDomainField(
      { entity: "Player", field: "isVeteran", type: "boolean", default: "true" },
      root,
    );
    expect(read("src/domain/Player.ts")).toContain("readonly isVeteran: boolean = true;");
    expect(read("src/validation/schemas.ts")).toContain(
      "isVeteran: z.boolean().default(true),",
    );

    scaffoldDomainField(
      { entity: "Player", field: "callsign", type: "string", default: "Maverick" },
      root,
    );
    expect(read("src/domain/Player.ts")).toContain(
      'readonly callsign: string = "Maverick";',
    );
    expect(read("src/validation/schemas.ts")).toContain(
      'callsign: z.string().default("Maverick"),',
    );
  });

  it("produces TypeScript with balanced braces (parse-able shape)", () => {
    writeFixtures();
    scaffoldDomainField(
      { entity: "Player", field: "techResearch", type: "number", default: "0" },
      root,
    );
    for (const p of [
      "src/domain/Player.ts",
      "src/validation/schemas.ts",
      "src/data/MigrationPipeline.ts",
    ]) {
      const text = read(p);
      const opens = (text.match(/\{/g) ?? []).length;
      const closes = (text.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });
});

describe("scaffoldDomainField — idempotency", () => {
  it("running twice does not duplicate the field or bump version twice", () => {
    writeFixtures();
    scaffoldDomainField(
      { entity: "Player", field: "techResearch", type: "number", default: "0" },
      root,
    );
    const second = scaffoldDomainField(
      { entity: "Player", field: "techResearch", type: "number", default: "0" },
      root,
    );

    // second run is all skips, no changes
    expect(second.changed).toEqual([]);
    expect(second.skipped).toEqual(
      expect.arrayContaining([
        "src/domain/Player.ts",
        "src/validation/schemas.ts",
        "src/data/MigrationPipeline.ts",
      ]),
    );

    const player = read("src/domain/Player.ts");
    const schemas = read("src/validation/schemas.ts");
    const mig = read("src/data/MigrationPipeline.ts");

    // exactly one occurrence everywhere
    expect((player.match(/techResearch/g) ?? []).length).toBe(1);
    expect((schemas.match(/techResearch:/g) ?? []).length).toBe(1);
    // version bumped exactly once (no 24), only one new migration entry added
    expect(mig).toContain("CURRENT_VERSION = 23");
    expect(mig).not.toContain("CURRENT_VERSION = 24");
    // the backfill assignment is the per-entry sentinel — exactly one entry
    expect((mig.match(/player\.techResearch = 0;/g) ?? []).length).toBe(1);
    expect((mig.match(/22: \(state: SaveState\) =>/g) ?? []).length).toBe(1);
  });
});

describe("scaffoldDomainField — error cases", () => {
  it("warns when the entity file is missing but still edits schema + migration", () => {
    writeFixtures();
    rmSync(join(root, "src/domain/Player.ts"));
    const res = scaffoldDomainField(
      { entity: "Player", field: "techResearch", type: "number", default: "0" },
      root,
    );
    expect(res.warnings.some((w) => w.includes("entity file not found"))).toBe(true);
    expect(res.changed).toContain("src/validation/schemas.ts");
  });

  it("warns when the schema for the entity is absent", () => {
    writeFixtures();
    const res = scaffoldDomainField(
      { entity: "Ghost", field: "x", type: "number", default: "0" },
      root,
    );
    // Ghost.ts and GhostSchema both missing → two warnings, no schema edit
    expect(res.warnings.some((w) => w.includes("entity file not found"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("schema not found"))).toBe(true);
    expect(read("src/validation/schemas.ts")).not.toContain("x:");
  });

  it("rejects an invalid field name without touching files", () => {
    writeFixtures();
    const before = read("src/validation/schemas.ts");
    const res = scaffoldDomainField(
      { entity: "Player", field: "bad name", type: "number", default: "0" },
      root,
    );
    expect(res.warnings.some((w) => w.includes("invalid field name"))).toBe(true);
    expect(res.changed).toEqual([]);
    expect(read("src/validation/schemas.ts")).toBe(before);
  });
});
