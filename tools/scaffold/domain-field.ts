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
  default?: string;
}

export interface ScaffoldResult {
  changed: string[];
  skipped: string[];
  warnings: string[];
  checklist: string[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

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

function lineStart(content: string, index: number): number {
  const nl = content.lastIndexOf("\n", index - 1);
  return nl === -1 ? 0 : nl + 1;
}

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

  const classOpen = m.index + m[0].length - 1;
  const classClose = matchingBrace(content, classOpen);
  if (classClose === -1) return { content, skipped: false, found: false };
  const classBody = content.slice(classOpen, classClose);

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

  const migRe = /migrations\s*:\s*Record<[\s\S]*?>\s*=\s*\{/;
  const migMatch = migRe.exec(content);
  if (!migMatch) return { content, skipped: false, found: false };
  const openBrace = content.indexOf("{", migMatch.index + migMatch[0].length - 1);
  const closeBrace = matchingBrace(content, openBrace);
  if (closeBrace === -1) return { content, skipped: false, found: false };

  const entityVar = lowerFirst(entity);
  const migBlock = content.slice(openBrace, closeBrace);
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
