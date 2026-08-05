import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SceneOptions {
  name: string;
  contextDependent?: boolean;
}

export interface ScaffoldResult {
  changed: string[];
  skipped: string[];
  warnings: string[];
  checklist: string[];
}

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

export function toScreamingSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toUpperCase();
}

export const sceneClassName = (name: string): string => `${name}Scene`;
export const pageObjectName = (name: string): string => `${name}ScenePage`;

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

function lineStart(content: string, index: number): number {
  const nl = content.lastIndexOf("\n", index - 1);
  return nl === -1 ? 0 : nl + 1;
}

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

export function insertFactoryCase(
  content: string,
  enumValue: string,
  className: string,
): { content: string; skipped: boolean; found: boolean } {
  const caseStr = `case SceneType.${enumValue}:`;
  if (content.includes(caseStr)) {
    return { content, skipped: true, found: true };
  }

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

  const scenePath = `src/presentation/${className}.ts`;
  const sceneAbs = join(root, scenePath);
  if (existsSync(sceneAbs)) {
    result.skipped.push(scenePath);
  } else {
    writeFileSync(sceneAbs, sceneFileTemplate(opts.name));
    result.changed.push(scenePath);
  }

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

  const pagePath = `e2e/page-objects/${pageObjectName(opts.name)}.ts`;
  const pageAbs = join(root, pagePath);
  if (existsSync(pageAbs)) {
    result.skipped.push(pagePath);
  } else {
    writeFileSync(pageAbs, pageObjectTemplate(opts.name));
    result.changed.push(pagePath);
  }

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
  const didNothing = result.changed.length === 0 && result.skipped.length === 0;
  if (result.warnings.length > 0 && !didNothing) {
    process.exit(3);
  }
  if (didNothing) {
    process.exit(1);
  }
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
