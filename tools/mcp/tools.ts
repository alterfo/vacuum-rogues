import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  findSymbolText,
  findTestsFor as pkgFindTestsFor,
} from "../../packages/vacuum-mcp/src/find-symbol.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..");

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

export function findSymbol(name: string): string {
  return findSymbolText(name, REPO_ROOT, { searchDirs: ["src"] });
}

export function findTestsFor(srcPath: string): string[] {
  return pkgFindTestsFor(srcPath, REPO_ROOT);
}

export function getArchitecture(): unknown {
  const json = readFileSync(join(here, "architecture.json"), "utf8");
  return JSON.parse(json);
}

export async function getBalanceConstants(): Promise<Record<string, unknown>> {
  const balancePath = join(REPO_ROOT, "src", "config", "balance.ts");
  const mod = (await import(pathToFileURL(balancePath).href)) as Record<
    string,
    unknown
  >;
  const result: Record<string, unknown> = {};
  if (mod.BALANCE && typeof mod.BALANCE === "object") {
    Object.assign(result, mod.BALANCE as Record<string, unknown>);
  }
  for (const [key, value] of Object.entries(mod)) {
    if (key === "BALANCE") continue;
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
