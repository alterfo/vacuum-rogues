/**
 * optimize-assets — convert `src/assets/**` art (PNG/JPG) to WebP in place.
 *
 * Why: `src/assets/` ships ~581 MB of PNG/JPG art. WebP shrinks both the repo
 * and the bundle with no caller changes — the manifest (`src/assets/manifest.ts`)
 * keys by path WITHOUT the extension and already globs `.webp`, so swapping
 * `nebula/red_mid.png` → `nebula/red_mid.webp` leaves `texture("nebula/red_mid")`
 * resolving to the new file. Converting and removing the original is therefore
 * transparent to every `texture()` / `texUrl` / `pickVariant` caller.
 *
 * Quality is chosen PER CATEGORY by the pure `webpOptionsFor`:
 *   - photoreal categories (nebula, panoramas, planets, …) → lossy ~q80
 *   - UI + icons → lossless (preserve crisp edges + alpha)
 *
 * Safety: each file is converted to a sibling `.webp`, the result is re-read and
 * its dimensions verified against the source, and only THEN is the original
 * deleted. Files already WebP are skipped, so the script is idempotent and
 * safe to re-run. `--dry-run` reports what would change without writing.
 *
 * Usage:
 *   npx tsx tools/optimize-assets.ts                 # convert all categories
 *   npx tsx tools/optimize-assets.ts --category ui   # one category
 *   npx tsx tools/optimize-assets.ts --dry-run       # report only, no writes
 */
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

/**
 * Photoreal categories — continuous-tone art where lossy WebP is a big win and
 * imperceptible at ~q80. Dimensions and alpha are preserved (no resize).
 */
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

/**
 * UI + icon categories — flat colour, sharp edges, alpha. Lossy WebP would
 * ring around edges and muddy transparency, so these go lossless.
 */
export const UI_CATEGORIES = ["ui", "icons"] as const;

/** WebP encode quality for the lossy (photoreal) path. */
export const PHOTOREAL_QUALITY = 85;

/** Sharp WebP options chosen by the category's leading path segment. */
export interface WebpOptions {
  lossless: boolean;
  /** Only meaningful when `lossless` is false. */
  quality?: number;
  /** Preserve full alpha (never drop the alpha channel). */
  alphaQuality: number;
  /** Encoder effort (0–6); 6 = smallest files, fine for a one-shot batch. */
  effort: number;
}

/**
 * Pure per-category WebP option selection. The category is the first path
 * segment under `src/assets/` (e.g. `nebula/red_mid` → `nebula`). UI + icons
 * are lossless; everything else (and any unknown category) defaults to the
 * lossy photoreal preset.
 */
export function webpOptionsFor(category: string): WebpOptions {
  if ((UI_CATEGORIES as readonly string[]).includes(category)) {
    return { lossless: true, alphaQuality: 100, effort: 6 };
  }
  return { lossless: false, quality: PHOTOREAL_QUALITY, alphaQuality: 100, effort: 6 };
}

/** The category (first path segment) of a repo-relative `src/assets/...` path. */
export function categoryOf(assetRelPath: string): string {
  return assetRelPath.split(/[\\/]/)[0] ?? "";
}

const CONVERTIBLE = /\.(png|jpe?g)$/i;

export interface ConvertResult {
  /** Absolute source path that was converted. */
  src: string;
  /** Absolute `.webp` path written. */
  dest: string;
  srcBytes: number;
  destBytes: number;
  width: number;
  height: number;
  category: string;
}

/**
 * Convert a single PNG/JPG file to a sibling `.webp`, verify the output's
 * dimensions match the source, then delete the original. Returns the result, or
 * `undefined` when the file is not a convertible image. Throws if the converted
 * file fails dimension verification (the original is then left intact).
 *
 * When `dryRun` is true, encodes + verifies in memory but writes/deletes
 * nothing (`destBytes` is still the real encoded size).
 */
export async function convertFile(
  srcAbs: string,
  category: string,
  dryRun = false,
): Promise<ConvertResult | undefined> {
  if (!CONVERTIBLE.test(srcAbs)) return undefined;

  const destAbs = srcAbs.replace(CONVERTIBLE, ".webp");
  const srcMeta = await sharp(srcAbs).metadata();
  // A source whose dimensions sharp can't read can't be dimension-verified —
  // refuse it rather than letting `undefined === undefined` pass the check
  // below and delete the original on an unverifiable conversion.
  if (srcMeta.width == null || srcMeta.height == null) {
    throw new Error(`could not read source dimensions for ${srcAbs}`);
  }
  const opts = webpOptionsFor(category);

  // Encode to a buffer first so we can verify before touching the filesystem.
  const buffer = await sharp(srcAbs).webp(opts).toBuffer();

  // Verify the encoded WebP is valid and preserved dimensions.
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
    // Write the EXACT verified bytes. `sharp(buffer).toFile(destAbs)` would
    // re-decode and re-encode the buffer with sharp's DEFAULT (lossy q80) WebP
    // settings, silently discarding the per-category lossless/quality choice
    // (e.g. ui/icons would ship lossy instead of lossless) and producing an
    // on-disk file that differs from the buffer we just verified.
    writeFileSync(destAbs, buffer);
    // Only remove the original after the .webp is safely on disk.
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

/** Recursively list absolute image file paths under `dir`. */
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
  /** Absolute path to the `src/assets` root. */
  assetsRoot: string;
  /** Limit to a single category (first path segment); undefined = all. */
  category?: string;
  dryRun?: boolean;
}

export interface OptimizeSummary {
  converted: ConvertResult[];
  /** Files skipped because they are already WebP. */
  skipped: string[];
  totalSrcBytes: number;
  totalDestBytes: number;
}

/** Convert every convertible image under the assets root (optionally one category). */
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

// Run only when invoked directly (tsx), not when imported by tests.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) void main();
