/**
 * vacuum-mcp tool implementations — pure logic, no MCP SDK dependency.
 *
 * These functions are what the MCP server (vacuum-mcp.ts) wraps, and what the
 * smoke tests (vacuum-mcp.test.ts) call directly. Keeping them SDK-free means
 * the tests do not need the MCP protocol or transport to run under vitest.
 *
 * All shell-outs use execFileSync with an argument array (never a shell string)
 * so caller-supplied names cannot be injected. Symbol/scene names are also
 * validated against a strict identifier allowlist before use.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** Repository root: tools/mcp/tools.ts -> two levels up. */
export const REPO_ROOT = resolve(here, "..", "..");

/** Identifiers we are willing to feed to grep (class/type/enum/scene names). */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Source paths we accept for find_tests_for (no traversal, no shell metachars). */
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/;

/**
 * Run grep and return matching lines. grep exits 1 when there are no matches;
 * we treat that as an empty result rather than an error. Any other failure
 * (exit >= 2, e.g. bad path) is re-thrown.
 */
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
    if (status === 1) return []; // no matches
    throw err;
  }
}

/**
 * find_symbol — locate where a type/class/interface/enum/const/function is declared.
 * Returns matching "file:line: text" lines (definitions preferred over usages).
 */
export function findSymbol(name: string): string {
  if (!IDENT.test(name)) {
    return `error: "${name}" is not a valid identifier`;
  }
  const pattern = `(export )?(default )?(abstract )?(class|interface|enum|type|const|function|let|var) ${name}\\b`;
  // --include=*.ts keeps grep off the binary art assets under src/assets.
  const lines = grepLines(["-rnE", "--include=*.ts", pattern, "src"]);
  return lines.length > 0
    ? lines.join("\n")
    : `no declaration found for "${name}" in src/`;
}

/**
 * find_tests_for — list test files that import the given source file by basename.
 * Returns an array of test file paths (possibly empty).
 */
export function findTestsFor(srcPath: string): string[] {
  if (!SAFE_PATH.test(srcPath)) return [];
  const base = basename(srcPath, extname(srcPath));
  if (!IDENT.test(base)) return [];
  return grepLines(["-rlnE", "--include=*.ts", `import.*${base}`, "src/tests"]);
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
    // Skip Zod schemas / functions; keep plain data.
    if (typeof value === "function") continue;
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
