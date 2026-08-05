import {
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const PHOTOREAL_CATEGORIES = [
  "nebula",
  "panoramas",
  "planets",
  "planet_maps",
  "stars",
  "star_maps",
  "portraits",
  "ships",
  "player_ships",
  "surfaces",
] as const;

export const UI_CATEGORIES = ["ui", "icons"] as const;

export const PHOTOREAL_QUALITY = 85;

export interface WebpOptions {
  lossless: boolean;
  quality?: number;
  alphaQuality: number;
  effort: number;
}

export function webpOptionsFor(category: string): WebpOptions {
  if ((UI_CATEGORIES as readonly string[]).includes(category)) {
    return { lossless: true, alphaQuality: 100, effort: 6 };
  }
  return { lossless: false, quality: PHOTOREAL_QUALITY, alphaQuality: 100, effort: 6 };
}

export function categoryOf(assetRelPath: string): string {
  return assetRelPath.split(/[\\/]/)[0] ?? "";
}

const CONVERTIBLE = /\.(png|jpe?g)$/i;

export interface ConvertResult {
  src: string;
  dest: string;
  srcBytes: number;
  destBytes: number;
  width: number;
  height: number;
  category: string;
}

export async function convertFile(
  srcAbs: string,
  category: string,
  dryRun = false,
): Promise<ConvertResult | undefined> {
  if (!CONVERTIBLE.test(srcAbs)) return undefined;

  const destAbs = srcAbs.replace(CONVERTIBLE, ".webp");
  const srcMeta = await sharp(srcAbs).metadata();
  if (srcMeta.width == null || srcMeta.height == null) {
    throw new Error(`could not read source dimensions for ${srcAbs}`);
  }
  const opts = webpOptionsFor(category);

  const buffer = await sharp(srcAbs).webp(opts).toBuffer();

  const outMeta = await sharp(buffer).metadata();
  if (outMeta.format !== "webp") {
    throw new Error(`conversion produced non-webp output for ${srcAbs}`);
  }
  if (outMeta.width !== srcMeta.width || outMeta.height !== srcMeta.height) {
    throw new Error(
      `dimension mismatch for ${srcAbs}: ${srcMeta.width}x${srcMeta.height} -> ${outMeta.width}x${outMeta.height}`,
    );
  }

  const srcBytes = statSync(srcAbs).size;

  if (!dryRun) {
    writeFileSync(destAbs, buffer);
    unlinkSync(srcAbs);
  }

  return {
    src: srcAbs,
    dest: destAbs,
    srcBytes,
    destBytes: buffer.length,
    width: srcMeta.width,
    height: srcMeta.height,
    category,
  };
}

export function listImages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...listImages(abs));
    } else if (CONVERTIBLE.test(entry) || extname(entry).toLowerCase() === ".webp") {
      out.push(abs);
    }
  }
  return out;
}

export interface OptimizeOptions {
  assetsRoot: string;
  category?: string;
  dryRun?: boolean;
}

export interface OptimizeSummary {
  converted: ConvertResult[];
  skipped: string[];
  totalSrcBytes: number;
  totalDestBytes: number;
}

export async function optimizeAssets(opts: OptimizeOptions): Promise<OptimizeSummary> {
  const root = opts.category ? join(opts.assetsRoot, opts.category) : opts.assetsRoot;
  const files = listImages(root);
  const summary: OptimizeSummary = {
    converted: [],
    skipped: [],
    totalSrcBytes: 0,
    totalDestBytes: 0,
  };

  for (const abs of files) {
    if (extname(abs).toLowerCase() === ".webp") {
      summary.skipped.push(abs);
      continue;
    }
    const category = categoryOf(relative(opts.assetsRoot, abs));
    const res = await convertFile(abs, category, opts.dryRun);
    if (res) {
      summary.converted.push(res);
      summary.totalSrcBytes += res.srcBytes;
      summary.totalDestBytes += res.destBytes;
    }
  }
  return summary;
}

interface CliArgs {
  category?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--category") out.category = argv[++i];
    else if (a.startsWith("--category=")) out.category = a.slice("--category=".length);
  }
  return out;
}

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const assetsRoot = resolve(here, "..", "src", "assets");

  process.stdout.write(
    `optimize-assets: ${args.dryRun ? "DRY RUN " : ""}root=${assetsRoot}` +
      `${args.category ? ` category=${args.category}` : " (all categories)"}\n`,
  );

  const summary = await optimizeAssets({
    assetsRoot,
    category: args.category,
    dryRun: args.dryRun,
  });

  for (const r of summary.converted) {
    const rel = relative(assetsRoot, r.src);
    process.stdout.write(
      `  ${args.dryRun ? "would convert" : "converted"} ${rel}` +
        ` (${fmtMB(r.srcBytes)} -> ${fmtMB(r.destBytes)})\n`,
    );
  }

  const saved = summary.totalSrcBytes - summary.totalDestBytes;
  process.stdout.write(
    `\n${summary.converted.length} converted, ${summary.skipped.length} already webp; ` +
      `${fmtMB(summary.totalSrcBytes)} -> ${fmtMB(summary.totalDestBytes)} ` +
      `(saved ${fmtMB(saved)})\n`,
  );
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) void main();
