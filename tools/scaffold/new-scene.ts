/**
 * new-scene — scaffold a new PixiJS scene across every registration file at once.
 *
 * Adding a scene in this codebase requires touching several files in lockstep
 * (see .claude/docs/adding-features.md "New Scene"):
 *   1. the scene class            — src/presentation/<Name>Scene.ts
 *   2. the SceneType enum         — src/types/index.ts
 *   3. the SceneFactory switch     — src/core/services/SceneFactory.ts (import + case)
 *   4. contextDependentScenes      — src/systems/GameEngine.ts (only if --context-dependent)
 *   5. the E2E Page Object         — e2e/page-objects/<Name>ScenePage.ts
 * Missing any one of these yields a scene that cannot be constructed, a blank
 * "Continue" screen, or an un-testable flow. This tool performs all five edits
 * atomically (and idempotently) from a single command.
 *
 * Usage:
 *   npx tsx tools/scaffold/new-scene.ts --name ResearchUpgrade --context-dependent
 *
 * Insertion is regex/brace-counting based (no AST) so it has no dependency on
 * the TypeScript compiler. The core logic is exported as `scaffoldScene` and
 * operates against an arbitrary root directory so tests can run it against a
 * temp fixture tree.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SceneOptions {
  /** PascalCase base name without the "Scene" suffix, e.g. "ResearchUpgrade". */
  name: string;
  /** Register the scene in GameEngine.contextDependentScenes when true. */
  contextDependent?: boolean;
}

export interface ScaffoldResult {
  /** Repo-relative paths that were created or modified. */
  changed: string[];
  /** Files that already contained the registration (no-op, idempotent). */
  skipped: string[];
  /** Non-fatal problems (missing file, missing anchor, …). */
  warnings: string[];
  /** Manual follow-up steps the developer still needs to do. */
  checklist: string[];
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

/** `ResearchUpgrade` -> `RESEARCH_UPGRADE`, `NPCRole` -> `NPC_ROLE`. */
export function toScreamingSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

export const sceneClassName = (name: string): string => `${name}Scene`;
export const pageObjectName = (name: string): string => `${name}ScenePage`;

/**
 * Returns the index of the bracket matching the opener at `openIndex`.
 * Works for `{` / `}` and `[` / `]` — counts only the matching pair.
 */
function matchingBracket(content: string, openIndex: number): number {
  const open = content[openIndex];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Start index of the line containing `index`. */
function lineStart(content: string, index: number): number {
  const nl = content.lastIndexOf("\n", index - 1);
  return nl === -1 ? 0 : nl + 1;
}

/** The class stub written to src/presentation/<Name>Scene.ts. */
export function sceneFileTemplate(name: string): string {
  const cls = sceneClassName(name);
  return `import { Container } from "pixi.js";
import { GameScene } from "./GameScene";
import type { Renderer } from "./Renderer";
import type { GameEngine } from "@/systems/GameEngine";
import { logger } from "@/utils/logger";

interface ${name}Context {
  gameEngine?: GameEngine;
}

/**
 * ${cls} — scaffolded scene stub. Replace the TODOs with real UI + logic.
 */
export class ${cls} extends GameScene {
  private gameEngine: GameEngine | null = null;
  private container: Container | null = null;

  constructor(renderer: Renderer) {
    super(renderer);
  }

  initialize(context?: object): void {
    const ctx = context as ${name}Context | undefined;
    this.gameEngine = ctx?.gameEngine ?? null;

    this.container = new Container();
    this.renderer.uiLayer.addChild(this.container);
    // TODO: build the ${name} scene UI here.
    logger.info("${cls} initialized", { hasEngine: this.gameEngine !== null });
  }

  update(_deltaTime: number): void {
    // TODO: per-frame updates.
  }

  destroy(): void {
    if (this.container) {
      this.container.destroy({ children: true });
      this.container = null;
    }
    this.renderer.clearGameLayer();
    this.renderer.clearUILayer();
    this.gameEngine = null;
  }
}
`;
}

/** The Page Object stub written to e2e/page-objects/<Name>ScenePage.ts. */
export function pageObjectTemplate(name: string): string {
  const cls = pageObjectName(name);
  return `import { type Page } from '@playwright/test';
import { GamePageBase } from './base.page';

/**
 * ${name} scene Page Object (scaffolded stub).
 *
 * TODO: add navigation + assertion helpers for the ${name} scene.
 */
export class ${cls} extends GamePageBase {
  constructor(page: Page) {
    super(page);
  }
}
`;
}

/**
 * Insert `  <ENUM> = "<ENUM>",` just before the closing brace of
 * `export enum SceneType { … }`. Idempotent within the enum block.
 */
export function insertSceneType(
  content: string,
  enumValue: string,
): { content: string; skipped: boolean; found: boolean } {
  const enumRe = /export\s+enum\s+SceneType\s*\{/;
  const m = enumRe.exec(content);
  if (!m) return { content, skipped: false, found: false };

  const openBrace = content.indexOf("{", m.index + m[0].length - 1);
  const closeBrace = matchingBracket(content, openBrace);
  if (closeBrace === -1) return { content, skipped: false, found: false };

  const block = content.slice(openBrace, closeBrace);
  const memberRe = new RegExp(`(?:^|\\n)\\s*${enumValue}\\s*=`);
  if (memberRe.test(block)) return { content, skipped: true, found: true };

  const insertAt = lineStart(content, closeBrace);
  const line = `  ${enumValue} = "${enumValue}",\n`;
  return {
    content: content.slice(0, insertAt) + line + content.slice(insertAt),
    skipped: false,
    found: true,
  };
}

/**
 * Add the scene import and a `case SceneType.<ENUM>: return new <Class>(renderer);`
 * to SceneFactory. The import is inserted after the last `@/presentation` import;
 * the case is inserted just before the switch's `default:`. Idempotent on both.
 */
export function insertFactoryCase(
  content: string,
  enumValue: string,
  className: string,
): { content: string; skipped: boolean; found: boolean } {
  const caseStr = `case SceneType.${enumValue}:`;
  if (content.includes(caseStr)) {
    return { content, skipped: true, found: true };
  }

  // 1. Import — after the last `from "@/presentation/...";` line.
  let next = content;
  const importStr = `import { ${className} } from "@/presentation/${className}";`;
  if (!next.includes(importStr)) {
    const importRe = /import\s*\{[^}]*\}\s*from\s*"@\/presentation\/[^"]+";/g;
    let lastImport: RegExpExecArray | null = null;
    let mm: RegExpExecArray | null;
    while ((mm = importRe.exec(next)) !== null) lastImport = mm;
    if (!lastImport) return { content, skipped: false, found: false };
    const after = lastImport.index + lastImport[0].length;
    next = next.slice(0, after) + `\n${importStr}` + next.slice(after);
  }

  // 2. Case — before the switch `default:`.
  const defaultRe = /(\n[ \t]*)default:/;
  const dm = defaultRe.exec(next);
  if (!dm) return { content, skipped: false, found: false };
  const insertAt = lineStart(next, dm.index + dm[1].length);
  const caseBlock =
    `      case SceneType.${enumValue}:\n` +
    `        return new ${className}(renderer);\n`;
  next = next.slice(0, insertAt) + caseBlock + next.slice(insertAt);

  return { content: next, skipped: false, found: true };
}

/**
 * Insert `      SceneType.<ENUM>,` before the closing `]` of the
 * `contextDependentScenes: SceneType[] = [ … ]` array. Idempotent.
 */
export function insertContextDependent(
  content: string,
  enumValue: string,
): { content: string; skipped: boolean; found: boolean } {
  const arrRe = /contextDependentScenes\s*:\s*SceneType\[\]\s*=\s*\[/;
  const m = arrRe.exec(content);
  if (!m) return { content, skipped: false, found: false };

  const openBracket = content.indexOf("[", m.index + m[0].length - 1);
  const closeBracket = matchingBracket(content, openBracket);
  if (closeBracket === -1) return { content, skipped: false, found: false };

  const block = content.slice(openBracket, closeBracket);
  const entryRe = new RegExp(`SceneType\\.${enumValue}\\b`);
  if (entryRe.test(block)) return { content, skipped: true, found: true };

  const insertAt = lineStart(content, closeBracket);
  const line = `      SceneType.${enumValue},\n`;
  return {
    content: content.slice(0, insertAt) + line + content.slice(insertAt),
    skipped: false,
    found: true,
  };
}

/**
 * Apply all scene-registration edits against `root`. Returns a structured
 * result; does not throw on missing files/anchors — they surface as warnings
 * so the caller can decide what to do (the CLI prints them, tests assert them).
 */
export function scaffoldScene(opts: SceneOptions, root: string): ScaffoldResult {
  const result: ScaffoldResult = {
    changed: [],
    skipped: [],
    warnings: [],
    checklist: [],
  };

  if (!PASCAL.test(opts.name)) {
    result.warnings.push(
      `invalid scene name: "${opts.name}" (expected PascalCase, e.g. ResearchUpgrade)`,
    );
    return result;
  }
  if (/Scene$/.test(opts.name)) {
    result.warnings.push(
      `drop the "Scene" suffix from --name (got "${opts.name}"); the tool appends it`,
    );
    return result;
  }

  const enumValue = toScreamingSnake(opts.name);
  const className = sceneClassName(opts.name);

  // 1. Scene class file (created, never patched).
  const scenePath = `src/presentation/${className}.ts`;
  const sceneAbs = join(root, scenePath);
  if (existsSync(sceneAbs)) {
    result.skipped.push(scenePath);
  } else {
    writeFileSync(sceneAbs, sceneFileTemplate(opts.name));
    result.changed.push(scenePath);
  }

  // 2. SceneType enum.
  const typesPath = "src/types/index.ts";
  const typesAbs = join(root, typesPath);
  if (!existsSync(typesAbs)) {
    result.warnings.push(`types file not found: ${typesPath}`);
  } else {
    const before = readFileSync(typesAbs, "utf8");
    const r = insertSceneType(before, enumValue);
    if (!r.found) {
      result.warnings.push(`could not find "export enum SceneType" in ${typesPath}`);
    } else if (r.skipped) {
      result.skipped.push(typesPath);
    } else {
      writeFileSync(typesAbs, r.content);
      result.changed.push(typesPath);
    }
  }

  // 3. SceneFactory import + case.
  const factoryPath = "src/core/services/SceneFactory.ts";
  const factoryAbs = join(root, factoryPath);
  if (!existsSync(factoryAbs)) {
    result.warnings.push(`scene factory not found: ${factoryPath}`);
  } else {
    const before = readFileSync(factoryAbs, "utf8");
    const r = insertFactoryCase(before, enumValue, className);
    if (!r.found) {
      result.warnings.push(
        `could not locate presentation imports / switch default in ${factoryPath}`,
      );
    } else if (r.skipped) {
      result.skipped.push(factoryPath);
    } else {
      writeFileSync(factoryAbs, r.content);
      result.changed.push(factoryPath);
    }
  }

  // 4. GameEngine.contextDependentScenes (opt-in).
  const enginePath = "src/systems/GameEngine.ts";
  if (opts.contextDependent) {
    const engineAbs = join(root, enginePath);
    if (!existsSync(engineAbs)) {
      result.warnings.push(`game engine not found: ${enginePath}`);
    } else {
      const before = readFileSync(engineAbs, "utf8");
      const r = insertContextDependent(before, enumValue);
      if (!r.found) {
        result.warnings.push(
          `could not find "contextDependentScenes: SceneType[] = [" in ${enginePath}`,
        );
      } else if (r.skipped) {
        result.skipped.push(enginePath);
      } else {
        writeFileSync(engineAbs, r.content);
        result.changed.push(enginePath);
      }
    }
  }

  // 5. E2E Page Object (created, never patched).
  const pagePath = `e2e/page-objects/${pageObjectName(opts.name)}.ts`;
  const pageAbs = join(root, pagePath);
  if (existsSync(pageAbs)) {
    result.skipped.push(pagePath);
  } else {
    writeFileSync(pageAbs, pageObjectTemplate(opts.name));
    result.changed.push(pagePath);
  }

  // Manual follow-up this tool deliberately does NOT automate.
  result.checklist.push(
    `Implement ${className}.initialize/update/destroy — the stub only mounts an empty container.`,
  );
  result.checklist.push(
    `Wire a transitionTo(SceneType.${enumValue}, …) call from whichever scene should open ${className}.`,
  );
  if (!opts.contextDependent) {
    result.checklist.push(
      `If ${className} needs transient context (planet/NPC/station), re-run with --context-dependent so "Continue" falls back to SPACE_FLIGHT.`,
    );
  }

  return result;
}

/** Minimal `--key value` / `--key=value` / boolean `--flag` argv parser. */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = "true";
      }
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name;
  if (!name) {
    process.stderr.write(
      "usage: new-scene --name <PascalCase> [--context-dependent]\n",
    );
    process.exit(2);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..", "..");
  const result = scaffoldScene(
    { name, contextDependent: args["context-dependent"] === "true" },
    root,
  );

  for (const f of result.changed) process.stdout.write(`  modified  ${f}\n`);
  for (const f of result.skipped) process.stdout.write(`  unchanged ${f} (already registered)\n`);
  for (const w of result.warnings) process.stdout.write(`  WARNING   ${w}\n`);
  if (result.checklist.length) {
    process.stdout.write("\nManual follow-up:\n");
    for (const c of result.checklist) process.stdout.write(`  - ${c}\n`);
  }
  // Exit codes signal lockstep integrity to automated callers (ralphex/CI/`&&`):
  //   3 = partial apply — some files were created/edited, but a warning means at
  //       least one required registration could not be (missing anchor/file), so
  //       the scene is half-wired (e.g. class created but no SceneFactory case).
  //   1 = nothing was applied at all.
  //   0 = every required edit applied (or already present on an idempotent re-run).
  const didNothing = result.changed.length === 0 && result.skipped.length === 0;
  if (result.warnings.length > 0 && !didNothing) {
    process.exit(3);
  }
  if (didNothing) {
    process.exit(1);
  }
}

// Run only when invoked directly (tsx), not when imported by tests.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
