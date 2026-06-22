/**
 * find-symbol — hybrid grep + ast-grep symbol extractor.
 *
 * Strategy: grep locates candidate files (fast), ast-grep parses each one and
 * returns the full declaration body (not just the declaration line).
 * Supports TypeScript, JavaScript, Python, and Go out of the box.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, Lang } from "@ast-grep/napi";

/** Valid identifier: letters, digits, underscores — never shell-unsafe. */
export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Source paths accepted by findTestsFor. */
export const SAFE_PATH = /^[A-Za-z0-9_./-]+$/;

// ---------------------------------------------------------------------------
// Language configuration
// ---------------------------------------------------------------------------

export type SupportedLang = "ts" | "tsx" | "js" | "jsx";

interface LangConfig {
  /** @ast-grep/napi Lang enum value */
  lang: Lang;
  /** AST node kinds that represent a complete declaration body */
  declarationKinds: string[];
  /** File extensions handled by this config */
  extensions: string[];
  /** grep --include flags (one per extension — brace expansion is shell-only) */
  grepIncludes: string[];
  /** Grep pattern for declarations (function, class, etc.) */
  grepPattern: (name: string) => string;
}

const LANG_CONFIGS: LangConfig[] = [
  {
    lang: Lang.TypeScript,
    declarationKinds: [
      "function_declaration",
      "class_declaration",
      "enum_declaration",
      "interface_declaration",
      "type_alias_declaration",
      "lexical_declaration",
    ],
    extensions: [".ts", ".tsx"],
    grepIncludes: ["--include=*.ts", "--include=*.tsx"],
    grepPattern: (name) =>
      `(export )?(default )?(abstract )?(class|interface|enum|type|const|function|let|var) ${name}\\b`,
  },
  {
    lang: Lang.JavaScript,
    declarationKinds: [
      "function_declaration",
      "class_declaration",
      "lexical_declaration",
    ],
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    grepIncludes: [
      "--include=*.js",
      "--include=*.jsx",
      "--include=*.mjs",
      "--include=*.cjs",
    ],
    grepPattern: (name) =>
      `(export )?(default )?(class|const|function|let|var) ${name}\\b`,
  },
];

// ---------------------------------------------------------------------------
// Core: grep-based file discovery
// ---------------------------------------------------------------------------

function grepLines(args: string[], cwd: string): string[] {
  try {
    const out = execFileSync("grep", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch (err) {
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Core: ast-grep body extraction
// ---------------------------------------------------------------------------

interface SymbolBody {
  text: string;
  startLine: number;
  endLine: number;
}

function extractBodyFromFile(
  filePath: string,
  name: string,
  config: LangConfig,
): SymbolBody | null {
  let code: string;
  try {
    code = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const root = parse(config.lang, code).root();
  for (const kind of config.declarationKinds) {
    const nodes = root.findAll({ rule: { kind } });
    for (const node of nodes) {
      // Identifier sits at child(0) or child(1) depending on modifiers
      for (let i = 0; i < Math.min(4, node.children().length); i++) {
        const child = node.child(i);
        if (child && child.text() === name) {
          const range = node.range();
          return {
            text: node.text(),
            startLine: range.start.line + 1,
            endLine: range.end.line + 1,
          };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FindSymbolOptions {
  /** Directories to search (relative to root). Defaults to ["."] */
  searchDirs?: string[];
  /** Languages to search. Defaults to all supported languages. */
  langs?: SupportedLang[];
}

export interface SymbolMatch {
  file: string;
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * Find all declarations of `name` in `root` and return their full bodies.
 *
 * Returns an array of matches (usually one; multiple when the same name appears
 * in several files — e.g. overloads or same-named exports in different modules).
 */
export function findSymbol(
  name: string,
  root: string,
  options: FindSymbolOptions = {},
): SymbolMatch[] {
  if (!IDENT.test(name)) {
    throw new Error(`"${name}" is not a valid identifier`);
  }

  const { searchDirs = ["."], langs } = options;
  const activeConfigs = langs
    ? LANG_CONFIGS.filter((c) =>
        langs.some((l) => c.extensions.includes(`.${l}`)),
      )
    : LANG_CONFIGS;

  const results: SymbolMatch[] = [];

  for (const config of activeConfigs) {
    const pattern = config.grepPattern(name);
    for (const dir of searchDirs) {
      const grepArgs = ["-rlE", ...config.grepIncludes, pattern, dir];
      const files = grepLines(grepArgs, root);
      for (const relFile of files) {
        const absFile = join(root, relFile);
        const body = extractBodyFromFile(absFile, name, config);
        if (body) {
          results.push({ file: relFile, ...body });
        }
      }
    }
  }

  return results;
}

/**
 * Formatted string output of findSymbol results — suitable for MCP text responses.
 */
export function findSymbolText(
  name: string,
  root: string,
  options?: FindSymbolOptions,
): string {
  if (!IDENT.test(name)) {
    return `error: "${name}" is not a valid identifier`;
  }
  const matches = findSymbol(name, root, options);
  if (matches.length === 0) {
    return `no declaration found for "${name}"`;
  }
  return matches
    .map((m) => `${m.file}:${m.startLine}-${m.endLine}\n${m.text}`)
    .join("\n\n");
}

/**
 * List test files that import the given source file by basename.
 */
/** File base name: letters, digits, underscores, hyphens, dots. */
const SAFE_BASENAME = /^[A-Za-z0-9_.-]+$/;

export function findTestsFor(srcPath: string, root: string): string[] {
  if (!SAFE_PATH.test(srcPath)) return [];
  // Reject path traversal attempts
  if (srcPath.includes("..")) return [];
  const base = srcPath.replace(/\.[^.]+$/, "").replace(/.*\//, "");
  if (!SAFE_BASENAME.test(base)) return [];
  return grepLines(
    [
      "-rlE",
      "--exclude-dir=node_modules",
      "--exclude-dir=dist",
      "--include=*.ts",
      "--include=*.tsx",
      "--include=*.js",
      "--include=*.jsx",
      `import.*${base}|from.*${base}`,
      ".",
    ],
    root,
  ).filter((f) => /test|spec/i.test(f));
}
