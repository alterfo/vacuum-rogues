import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  insertContextDependent,
  insertFactoryCase,
  insertSceneType,
  pageObjectName,
  scaffoldScene,
  sceneClassName,
  toScreamingSnake,
} from "./new-scene";

const TYPES_TS = `export enum SceneType {
  MAIN_MENU = "MAIN_MENU",
  STAR_MAP = "STAR_MAP",
  WIN_SCREEN = "WIN_SCREEN",
}

export enum StationType {
  TRADE_POST = "TRADE_POST",
}
`;

const FACTORY_TS = `import type { GameScene } from "@/presentation/GameScene";
import type { Renderer } from "@/presentation/Renderer";
import { SceneType } from "@/types";
import { MainMenuScene } from "@/presentation/MainMenuScene";
import { WinScene } from "@/presentation/WinScene";

export class SceneFactory {
  createScene(type: SceneType, renderer: Renderer): GameScene | null {
    switch (type) {
      case SceneType.MAIN_MENU:
        return new MainMenuScene(renderer);
      case SceneType.WIN_SCREEN:
        return new WinScene(renderer);
      default:
        return null;
    }
  }
}
`;

const ENGINE_TS = `import { SceneType } from "@/types";

export class GameEngine {
  loadGame(): void {
    const contextDependentScenes: SceneType[] = [
      SceneType.PLANET,
      SceneType.TRADE,
      SceneType.WIN_SCREEN,
    ];
    void contextDependentScenes;
  }
}
`;

let root: string;

function writeFixtures(): void {
  mkdirSync(join(root, "src/presentation"), { recursive: true });
  mkdirSync(join(root, "src/types"), { recursive: true });
  mkdirSync(join(root, "src/core/services"), { recursive: true });
  mkdirSync(join(root, "src/systems"), { recursive: true });
  mkdirSync(join(root, "e2e/page-objects"), { recursive: true });
  writeFileSync(join(root, "src/types/index.ts"), TYPES_TS);
  writeFileSync(join(root, "src/core/services/SceneFactory.ts"), FACTORY_TS);
  writeFileSync(join(root, "src/systems/GameEngine.ts"), ENGINE_TS);
}

const read = (p: string) => readFileSync(join(root, p), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "new-scene-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("name helpers", () => {
  it("converts PascalCase to SCREAMING_SNAKE_CASE", () => {
    expect(toScreamingSnake("ResearchUpgrade")).toBe("RESEARCH_UPGRADE");
    expect(toScreamingSnake("TestScene")).toBe("TEST_SCENE");
    expect(toScreamingSnake("NPCRole")).toBe("NPC_ROLE");
    expect(toScreamingSnake("Planet")).toBe("PLANET");
  });

  it("derives class and page-object names", () => {
    expect(sceneClassName("ResearchUpgrade")).toBe("ResearchUpgradeScene");
    expect(pageObjectName("ResearchUpgrade")).toBe("ResearchUpgradeScenePage");
  });
});

describe("insertion helpers", () => {
  it("inserts a SceneType member before the closing brace, not into StationType", () => {
    const r = insertSceneType(TYPES_TS, "RESEARCH_UPGRADE");
    expect(r.found).toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.content).toContain('RESEARCH_UPGRADE = "RESEARCH_UPGRADE",');
    const sceneBlock = r.content.slice(
      r.content.indexOf("enum SceneType"),
      r.content.indexOf("enum StationType"),
    );
    expect(sceneBlock).toContain("RESEARCH_UPGRADE");
    const stationBlock = r.content.slice(r.content.indexOf("enum StationType"));
    expect(stationBlock).not.toContain("RESEARCH_UPGRADE");
  });

  it("inserts both the import and the case before default", () => {
    const r = insertFactoryCase(FACTORY_TS, "RESEARCH_UPGRADE", "ResearchUpgradeScene");
    expect(r.found).toBe(true);
    expect(r.content).toContain(
      'import { ResearchUpgradeScene } from "@/presentation/ResearchUpgradeScene";',
    );
    expect(r.content).toContain("case SceneType.RESEARCH_UPGRADE:");
    expect(r.content).toContain("return new ResearchUpgradeScene(renderer);");
    expect(r.content.indexOf("SceneType.RESEARCH_UPGRADE")).toBeLessThan(
      r.content.indexOf("default:"),
    );
  });

  it("inserts into the contextDependentScenes array", () => {
    const r = insertContextDependent(ENGINE_TS, "RESEARCH_UPGRADE");
    expect(r.found).toBe(true);
    expect(r.content).toContain("SceneType.RESEARCH_UPGRADE,");
  });
});

describe("scaffoldScene — happy path", () => {
  it("creates/edits all five registration outputs", () => {
    writeFixtures();
    const res = scaffoldScene({ name: "ResearchUpgrade", contextDependent: true }, root);

    expect(res.warnings).toEqual([]);
    expect(res.changed).toEqual(
      expect.arrayContaining([
        "src/presentation/ResearchUpgradeScene.ts",
        "src/types/index.ts",
        "src/core/services/SceneFactory.ts",
        "src/systems/GameEngine.ts",
        "e2e/page-objects/ResearchUpgradeScenePage.ts",
      ]),
    );

    const scene = read("src/presentation/ResearchUpgradeScene.ts");
    expect(scene).toContain("export class ResearchUpgradeScene extends GameScene");
    expect(scene).toContain("initialize(context?: object): void");
    expect(scene).toContain("update(_deltaTime: number): void");
    expect(scene).toContain("destroy(): void");

    expect(read("src/types/index.ts")).toContain(
      'RESEARCH_UPGRADE = "RESEARCH_UPGRADE",',
    );

    const factory = read("src/core/services/SceneFactory.ts");
    expect(factory).toContain(
      'import { ResearchUpgradeScene } from "@/presentation/ResearchUpgradeScene";',
    );
    expect(factory).toContain("case SceneType.RESEARCH_UPGRADE:");
    expect(factory).toContain("return new ResearchUpgradeScene(renderer);");

    expect(read("src/systems/GameEngine.ts")).toContain("SceneType.RESEARCH_UPGRADE,");

    const page = read("e2e/page-objects/ResearchUpgradeScenePage.ts");
    expect(page).toContain("export class ResearchUpgradeScenePage extends GamePageBase");

    expect(res.checklist.length).toBeGreaterThan(0);
  });

  it("skips contextDependentScenes when --context-dependent is not passed", () => {
    writeFixtures();
    const res = scaffoldScene({ name: "ResearchUpgrade" }, root);
    expect(res.warnings).toEqual([]);
    expect(read("src/systems/GameEngine.ts")).not.toContain("SceneType.RESEARCH_UPGRADE");
    expect(res.changed).not.toContain("src/systems/GameEngine.ts");
    expect(res.checklist.some((c) => c.includes("--context-dependent"))).toBe(true);
  });

  it("produces TypeScript with balanced braces (parse-able shape)", () => {
    writeFixtures();
    scaffoldScene({ name: "ResearchUpgrade", contextDependent: true }, root);
    for (const p of [
      "src/presentation/ResearchUpgradeScene.ts",
      "src/types/index.ts",
      "src/core/services/SceneFactory.ts",
      "src/systems/GameEngine.ts",
    ]) {
      const text = read(p);
      expect((text.match(/\{/g) ?? []).length).toBe((text.match(/\}/g) ?? []).length);
      expect((text.match(/\[/g) ?? []).length).toBe((text.match(/\]/g) ?? []).length);
    }
  });
});

describe("scaffoldScene — idempotency", () => {
  it("running twice does not duplicate any registration", () => {
    writeFixtures();
    scaffoldScene({ name: "ResearchUpgrade", contextDependent: true }, root);
    const second = scaffoldScene({ name: "ResearchUpgrade", contextDependent: true }, root);

    expect(second.changed).toEqual([]);
    expect(second.skipped).toEqual(
      expect.arrayContaining([
        "src/presentation/ResearchUpgradeScene.ts",
        "src/types/index.ts",
        "src/core/services/SceneFactory.ts",
        "src/systems/GameEngine.ts",
        "e2e/page-objects/ResearchUpgradeScenePage.ts",
      ]),
    );

    const types = read("src/types/index.ts");
    const factory = read("src/core/services/SceneFactory.ts");
    const engine = read("src/systems/GameEngine.ts");

    expect((types.match(/RESEARCH_UPGRADE = "RESEARCH_UPGRADE",/g) ?? []).length).toBe(1);
    expect((factory.match(/case SceneType\.RESEARCH_UPGRADE:/g) ?? []).length).toBe(1);
    expect((factory.match(/import \{ ResearchUpgradeScene \}/g) ?? []).length).toBe(1);
    expect((engine.match(/SceneType\.RESEARCH_UPGRADE,/g) ?? []).length).toBe(1);
  });
});

describe("scaffoldScene — error cases", () => {
  it("rejects a non-PascalCase name without touching files", () => {
    writeFixtures();
    const before = read("src/types/index.ts");
    const res = scaffoldScene({ name: "research_upgrade" }, root);
    expect(res.warnings.some((w) => w.includes("invalid scene name"))).toBe(true);
    expect(res.changed).toEqual([]);
    expect(read("src/types/index.ts")).toBe(before);
  });

  it("rejects a name that already carries the Scene suffix", () => {
    writeFixtures();
    const res = scaffoldScene({ name: "ResearchScene" }, root);
    expect(res.warnings.some((w) => w.includes('drop the "Scene" suffix'))).toBe(true);
    expect(res.changed).toEqual([]);
    expect(existsSync(join(root, "src/presentation/ResearchSceneScene.ts"))).toBe(false);
  });

  it("warns when the SceneType enum is missing but still creates the scene file", () => {
    writeFixtures();
    rmSync(join(root, "src/types/index.ts"));
    const res = scaffoldScene({ name: "ResearchUpgrade" }, root);
    expect(res.warnings.some((w) => w.includes("types file not found"))).toBe(true);
    expect(res.changed).toContain("src/presentation/ResearchUpgradeScene.ts");
  });
});
