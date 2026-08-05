import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SCAN_ROOTS,
  findCyrillicLiterals,
  isExcluded,
  scanFiles,
  totalHits,
  type CyrillicHit,
  type FileBacklog,
} from "../../src/i18n/cyrillicLiterals";

export {
  DEFAULT_SCAN_ROOTS,
  findCyrillicLiterals,
  isExcluded,
  scanFiles,
  totalHits,
};
export type { CyrillicHit, FileBacklog };

function main(): void {
  const argv = process.argv.slice(2);
  const list = argv.includes("--list");
  const roots = argv.filter((a) => !a.startsWith("--"));
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const scanRoots = roots.length > 0 ? roots : DEFAULT_SCAN_ROOTS;

  const backlogs = scanFiles(scanRoots, projectRoot);
  const total = totalHits(backlogs);

  process.stdout.write(
    `i18n backlog: ${total} inline Cyrillic literal(s) in ` +
      `${backlogs.length} file(s) under [${scanRoots.join(", ")}]\n\n`,
  );

  for (const b of backlogs) {
    process.stdout.write(`  ${String(b.hits.length).padStart(4)}  ${b.file}\n`);
    if (list) {
      for (const h of b.hits) {
        const preview =
          h.text.length > 60 ? `${h.text.slice(0, 57)}…` : h.text;
        process.stdout.write(`        ${h.line}: ${preview}\n`);
      }
    }
  }
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
