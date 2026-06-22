/**
 * vacuum-mcp tool implementations — pure logic, no MCP SDK dependency.
 *
 * These functions are what the MCP server (vacuum-mcp.ts) wraps, and what the
 * smoke tests (vacuum-mcp.test.ts) call directly. Keeping them SDK-free means
 * the tests do not need the MCP protocol or transport to run under vitest.
 *
 * findSymbol / findTestsFor delegate to the standalone vacuum-mcp package
 * (packages/vacuum-mcp). Project-specific tools (getArchitecture, getBalanceConstants,
 * getSceneInfo) remain here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  findSymbolText,
  findTestsFor as pkgFindTestsFor,
} from "../../packages/vacuum-mcp/src/find-symbol.js";

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root: tools/mcp/tools.ts -> two levels up. */
export const REPO_ROOT = resolve(here, "..", "..");

/** Identifiers we are willing to feed to grep (scene names). */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function grepLines(args: string[]): string[] {
  try {
    const out = execFileSync("grep", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 1) return [];
    throw err;
  }
}

/**
 * find_symbol — return the full source body of a declared symbol.
 * Delegates to the vacuum-mcp package (grep + ast-grep hybrid).
 */
export function findSymbol(name: string): string {
  return findSymbolText(name, REPO_ROOT, { searchDirs: ["src"] });
}

/**
 * find_tests_for — list test files that import the given source file.
 * Delegates to the vacuum-mcp package.
 */
export function findTestsFor(srcPath: string): string[] {
  return pkgFindTestsFor(srcPath, REPO_ROOT);
}

/** get_architecture — static layer map / lockstep rules / entry points. */
export function getArchitecture(): unknown {
  const json = readFileSync(join(here, "architecture.json"), "utf8");
  return JSON.parse(json);
}

/**
 * get_balance_constants — import src/config/balance.ts and return its numeric
 * constants flattened to the top level (so e.g. STARTING_MONEY is directly
 * accessible). balance.ts only depends on zod — no PixiJS/DOM, safe to import.
 */
export async function getBalanceConstants(): Promise<Record<string, unknown>> {
  const balancePath = join(REPO_ROOT, "src", "config", "balance.ts");
  const mod = (await import(pathToFileURL(balancePath).href)) as Record<
    string,
    unknown
  >;
  const result: Record<string, unknown> = {};
  // Spread the validated BALANCE object's keys to the top level.
  if (mod.BALANCE && typeof mod.BALANCE === "object") {
    Object.assign(result, mod.BALANCE as Record<string, unknown>);
  }
  // Include every other exported constant by its export name.
  for (const [key, value] of Object.entries(mod)) {
    if (key === "BALANCE") continue;
    // Skip functions and Zod schema objects (they expose a `safeParse` method);
    // keep plain data constants only, so the output is the flat numeric map
    // callers expect rather than including e.g. the BalanceSchema definition.
    if (typeof value === "function") continue;
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { safeParse?: unknown }).safeParse === "function"
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * get_scene_info — grep the key lifecycle lines (initialize / update / destroy /
 * transitionTo) of a scene without reading the whole (often 1,000+ line) file.
 */
export function getSceneInfo(sceneName: string): string {
  if (!IDENT.test(sceneName)) {
    return `error: "${sceneName}" is not a valid scene name`;
  }
  const scenePath = join("src", "presentation", `${sceneName}.ts`);
  if (!existsSync(join(REPO_ROOT, scenePath))) {
    return `scene file not found: ${scenePath}`;
  }
  const lines = grepLines([
    "-nE",
    "initialize|update|destroy|transitionTo",
    scenePath,
  ]);
  return lines.length > 0 ? lines.join("\n") : `no lifecycle methods found in ${scenePath}`;
}
