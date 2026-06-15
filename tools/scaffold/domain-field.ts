/**
 * domain-field — scaffold a new domain field across every lockstep file at once.
 *
 * Adding a field to a domain entity in this codebase requires touching several
 * files in lockstep (see CLAUDE.md "New Domain Field"):
 *   1. the domain class           — src/domain/<Entity>.ts
 *   2. the Zod validation schema   — src/validation/schemas.ts
 *   3. a migration step            — src/data/MigrationPipeline.ts
 * Missing any one of these silently breaks save/load. This tool performs all
 * three edits atomically (and idempotently) from a single command.
 *
 * Usage:
 *   npx tsx tools/scaffold/domain-field.ts --entity Player --field techResearch --type number --default 0
 *
 * Insertion is regex/brace-counting based (no AST) so it has no dependency on
 * the TypeScript compiler. The core logic is exported as `scaffoldDomainField`
 * and operates against an arbitrary root directory so tests can run it against
 * a temp fixture tree.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type FieldType = "number" | "boolean" | "string";

export interface DomainFieldOptions {
  entity: string;
  field: string;
  type: FieldType;
  /** Raw default as given on the CLI; undefined falls back to a type default. */
  default?: string;
}

export interface ScaffoldResult {
  /** Repo-relative paths that were modified. */
  changed: string[];
  /** Files that already contained the field (no-op, idempotent). */
  skipped: string[];
  /** Non-fatal problems (missing file, missing schema, …). */
  warnings: string[];
  /** Manual follow-up steps the developer still needs to do. */
  checklist: string[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Lower-cases the first character: `Player` -> `player`, `StarSystem` -> `starSystem`. */
function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Renders the TypeScript literal for a default value of the given type. */
export function defaultLiteral(type: FieldType, raw: string | undefined): string {
  switch (type) {
    case "number": {
      const n = Number(raw ?? "0");
      return Number.isFinite(n) ? String(n) : "0";
    }
    case "boolean":
      return raw === "true" ? "true" : "false";
    case "string":
      return JSON.stringify(raw ?? "");
  }
}

/** Renders the Zod expression for a field of the given type + default. */
export function zodExpr(type: FieldType, raw: string | undefined): string {
  const lit = defaultLiteral(type, raw);
  switch (type) {
    case "number":
      return `z.number().default(${lit})`;
    case "boolean":
      return `z.boolean().default(${lit})`;
    case "string":
      return `z.string().default(${lit})`;
  }
}

/**
 * Returns the index of the brace matching the `{` at `openIndex`.
 * Counts only braces — parens/brackets inside the block are balanced and
 * contain no stray braces in our source.
 */
function matchingBrace(content: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
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

/**
 * Insert a `readonly <field>: <type> = <default>;` class property right after
 * the opening brace of `class <Entity>`. Idempotent: if the class body already
 * declares the field, returns the content unchanged with `skipped: true`.
 */
export function insertClassField(
  content: string,
  entity: string,
  field: string,
  type: FieldType,
  defaultRaw: string | undefined,
): { content: string; skipped: boolean; found: boolean } {
  const classRe = new RegExp(`(export\\s+)?(abstract\\s+)?class\\s+${entity}\\b[^{]*\\{`);
  const m = classRe.exec(content);
  if (!m) return { content, skipped: false, found: false };

  // Scope the "already declared?" check to THIS class body only. Multi-class
  // files (e.g. ShipModule.ts, GalacticEvent.ts) must not false-skip just
  // because a sibling class declares a field of the same name — that would
  // edit the schema/migration while leaving the domain object missing the field.
  const classOpen = m.index + m[0].length - 1;
  const classClose = matchingBrace(content, classOpen);
  if (classClose === -1) return { content, skipped: false, found: false };
  const classBody = content.slice(classOpen, classClose);

  // Already declared? (field followed by `:` or `=`, optionally with modifiers)
  const fieldRe = new RegExp(
    `(?:^|\\n)\\s*(?:public\\s+|private\\s+|protected\\s+|readonly\\s+)*${field}\\b\\s*[:=]`,
  );
  if (fieldRe.test(classBody)) return { content, skipped: true, found: true };

  const insertAt = m.index + m[0].length;
  const line = `\n  readonly ${field}: ${type} = ${defaultLiteral(type, defaultRaw)};`;
  return {
    content: content.slice(0, insertAt) + line + content.slice(insertAt),
    skipped: false,
    found: true,
  };
}

/**
 * Insert a `<field>: <zodExpr>,` line just before the closing brace of
 * `export const <Entity>Schema = z.object({ … })`. Idempotent within the block.
 */
export function insertSchemaField(
  content: string,
  entity: string,
  field: string,
  type: FieldType,
  defaultRaw: string | undefined,
): { content: string; skipped: boolean; found: boolean } {
  const schemaRe = new RegExp(`export\\s+const\\s+${entity}Schema\\s*=\\s*z\\.object\\(`);
  const m = schemaRe.exec(content);
  if (!m) return { content, skipped: false, found: false };

  const openBrace = content.indexOf("{", m.index + m[0].length);
  if (openBrace === -1) return { content, skipped: false, found: false };
  const closeBrace = matchingBrace(content, openBrace);
  if (closeBrace === -1) return { content, skipped: false, found: false };

  const block = content.slice(openBrace, closeBrace);
  const fieldRe = new RegExp(`(?:^|\\n)\\s*${field}\\s*:`);
  if (fieldRe.test(block)) return { content, skipped: true, found: true };

  const insertAt = lineStart(content, closeBrace);
  const line = `  ${field}: ${zodExpr(type, defaultRaw)},\n`;
  return {
    content: content.slice(0, insertAt) + line + content.slice(insertAt),
    skipped: false,
    found: true,
  };
}

/**
 * Bump CURRENT_VERSION and append a backfill migration entry keyed at the old
 * current version. Idempotent: if the field is already referenced anywhere in
 * the migrations object, leaves the file unchanged.
 */
export function insertMigration(
  content: string,
  entity: string,
  field: string,
  type: FieldType,
  defaultRaw: string | undefined,
): { content: string; skipped: boolean; found: boolean; fromVersion?: number } {
  const verRe = /CURRENT_VERSION\s*=\s*(\d+)/;
  const verMatch = verRe.exec(content);
  if (!verMatch) return { content, skipped: false, found: false };
  const oldVersion = Number(verMatch[1]);
  const newVersion = oldVersion + 1;

  // `[\s\S]*?>` skips the generic args (which contain `=>`); backtracking lands
  // on the Record<…> closing `>` so we match `migrations: Record<…> = {`.
  const migRe = /migrations\s*:\s*Record<[\s\S]*?>\s*=\s*\{/;
  const migMatch = migRe.exec(content);
  if (!migMatch) return { content, skipped: false, found: false };
  const openBrace = content.indexOf("{", migMatch.index + migMatch[0].length - 1);
  const closeBrace = matchingBrace(content, openBrace);
  if (closeBrace === -1) return { content, skipped: false, found: false };

  const entityVar = lowerFirst(entity);
  const migBlock = content.slice(openBrace, closeBrace);
  // Idempotency: did a previous run already add a backfill for THIS entity.field?
  // Match the backfill assignment the tool emits (e.g. `player.level`), not a
  // bare `\bfield\b` — the latter false-skips when the field name happens to
  // appear in an unrelated migration comment or a sibling field's backfill,
  // leaving the schema/class edited but no migration written (broken lockstep).
  const backfillRe = new RegExp(`\\b${entityVar}\\.${field}\\b`);
  if (backfillRe.test(migBlock)) {
    return { content, skipped: true, found: true, fromVersion: oldVersion };
  }

  const lit = defaultLiteral(type, defaultRaw);
  const entry =
    `    // ${oldVersion} -> ${newVersion}: ${field} added to ${entity} (scaffolded).\n` +
    `    // Old saves lack this field; backfill with the schema default.\n` +
    `    ${oldVersion}: (state: SaveState) => {\n` +
    `      const ${entityVar} = state.${entityVar} as unknown as { ${field}?: ${type} };\n` +
    `      if (${entityVar} && ${entityVar}.${field} === undefined) {\n` +
    `        ${entityVar}.${field} = ${lit};\n` +
    `      }\n` +
    `    },\n`;

  const insertAt = lineStart(content, closeBrace);
  let next = content.slice(0, insertAt) + entry + content.slice(insertAt);
  next = next.replace(verRe, `CURRENT_VERSION = ${newVersion}`);
  return { content: next, skipped: false, found: true, fromVersion: oldVersion };
}

/**
 * Apply all three lockstep edits against `root`. Returns a structured result;
 * does not throw on missing files — they surface as warnings so the caller can
 * decide what to do (the CLI prints them, tests assert on them).
 */
export function scaffoldDomainField(
  opts: DomainFieldOptions,
  root: string,
): ScaffoldResult {
  const result: ScaffoldResult = {
    changed: [],
    skipped: [],
    warnings: [],
    checklist: [],
  };

  if (!IDENT.test(opts.entity)) {
    result.warnings.push(`invalid entity name: "${opts.entity}"`);
    return result;
  }
  if (!IDENT.test(opts.field)) {
    result.warnings.push(`invalid field name: "${opts.field}"`);
    return result;
  }

  // 1. Domain class
  const domainPath = `src/domain/${opts.entity}.ts`;
  const domainAbs = join(root, domainPath);
  if (!existsSync(domainAbs)) {
    result.warnings.push(`entity file not found: ${domainPath}`);
  } else {
    const before = readFileSync(domainAbs, "utf8");
    const r = insertClassField(before, opts.entity, opts.field, opts.type, opts.default);
    if (!r.found) {
      result.warnings.push(`could not find "class ${opts.entity}" in ${domainPath}`);
    } else if (r.skipped) {
      result.skipped.push(domainPath);
    } else {
      writeFileSync(domainAbs, r.content);
      result.changed.push(domainPath);
    }
  }

  // 2. Zod schema
  const schemaPath = "src/validation/schemas.ts";
  const schemaAbs = join(root, schemaPath);
  if (!existsSync(schemaAbs)) {
    result.warnings.push(`schema file not found: ${schemaPath}`);
  } else {
    const before = readFileSync(schemaAbs, "utf8");
    const r = insertSchemaField(before, opts.entity, opts.field, opts.type, opts.default);
    if (!r.found) {
      result.warnings.push(`schema not found: export const ${opts.entity}Schema = z.object({ … }) in ${schemaPath}`);
    } else if (r.skipped) {
      result.skipped.push(schemaPath);
    } else {
      writeFileSync(schemaAbs, r.content);
      result.changed.push(schemaPath);
    }
  }

  // 3. Migration
  const migPath = "src/data/MigrationPipeline.ts";
  const migAbs = join(root, migPath);
  if (!existsSync(migAbs)) {
    result.warnings.push(`migration pipeline not found: ${migPath}`);
  } else {
    const before = readFileSync(migAbs, "utf8");
    const r = insertMigration(before, opts.entity, opts.field, opts.type, opts.default);
    if (!r.found) {
      result.warnings.push(`could not locate CURRENT_VERSION / migrations map in ${migPath}`);
    } else if (r.skipped) {
      result.skipped.push(migPath);
    } else {
      writeFileSync(migAbs, r.content);
      result.changed.push(migPath);
    }
  }

  // Manual follow-up that this tool deliberately does NOT automate.
  result.checklist.push(
    `Refine the Zod constraint in ${schemaPath} if needed (e.g. .int().min(0)); the scaffold used a plain ${opts.type}.`,
  );
  result.checklist.push(
    `If ${opts.entity} is constructed manually (factories, SaveStateSerializer, test builders), ensure the new field is wired through.`,
  );
  result.checklist.push(
    `The migration stub assumes state.${lowerFirst(opts.entity)} is top-level. If ${opts.entity} is nested (e.g. galaxy.systems[]), adjust the backfill accordingly.`,
  );

  return result;
}

/** Minimal `--key value` / `--key=value` argv parser. */
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
  const entity = args.entity;
  const field = args.field;
  const type = args.type as FieldType;
  if (!entity || !field || !type) {
    process.stderr.write(
      "usage: domain-field --entity <Name> --field <name> --type <number|boolean|string> [--default <v>]\n",
    );
    process.exit(2);
  }
  if (type !== "number" && type !== "boolean" && type !== "string") {
    process.stderr.write(`unsupported --type "${type}" (number|boolean|string)\n`);
    process.exit(2);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..", "..");
  const result = scaffoldDomainField(
    { entity, field, type, default: args.default },
    root,
  );

  for (const f of result.changed) process.stdout.write(`  modified  ${f}\n`);
  for (const f of result.skipped) process.stdout.write(`  unchanged ${f} (field already present)\n`);
  for (const w of result.warnings) process.stdout.write(`  WARNING   ${w}\n`);
  if (result.checklist.length) {
    process.stdout.write("\nManual follow-up:\n");
    for (const c of result.checklist) process.stdout.write(`  - ${c}\n`);
  }
  if (result.changed.length === 0 && result.skipped.length === 0) {
    process.exit(1);
  }
}

// Run only when invoked directly (tsx), not when imported by tests.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
