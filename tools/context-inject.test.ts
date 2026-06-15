/**
 * Tests for the context-inject.sh ralphex task-orientation helper.
 *
 * The script parses a ralphex plan, finds the target Task section (an explicit
 * number, or the first with an unchecked [ ] box), and prints its **Files:**
 * block annotated with each file's on-disk status. We shell out to the real
 * script against a fixture plan written to a temp file, and assert the report
 * and the documented exit codes. File paths in a plan are resolved relative to
 * the repo root, so the fixture references a file that really exists
 * (package.json) and one that cannot (a sentinel name).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "context-inject.sh");

const FIXTURE_PLAN = `---
# Fixture plan

## Overview
x

## Context
x

## Development Approach
x

## Implementation Steps

### Task 1: Already done
**Files:**
- Modify: \`package.json\` (a real repo file)

- [x] done item

### Task 2: First unchecked
**Files:**
- Create: \`tools/__ci_nonexistent_sentinel__.ts\`
- Modify: \`package.json\`

- [ ] todo item

## Technical Details
ignored
`;

/** Run the script; return {stdout, status}. Captures non-zero exits without throwing. */
function run(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString() ?? ""),
      status: e.status ?? -1,
    };
  }
}

function withFixture<T>(fn: (planPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ctx-inject-"));
  const planPath = join(dir, "plan.md");
  writeFileSync(planPath, FIXTURE_PLAN);
  try {
    return fn(planPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("context-inject.sh", () => {
  it("auto-selects the first task with an unchecked [ ] box (Task 2)", () => {
    withFixture((plan) => {
      const { stdout, status } = run([plan]);
      expect(status).toBe(0);
      expect(stdout).toContain("Active task 2: First unchecked");
      expect(stdout).toContain("tools/__ci_nonexistent_sentinel__.ts — to be created");
      expect(stdout).toMatch(/package\.json — exists, \d+ lines/);
    });
  });

  it("honors an explicit task number", () => {
    withFixture((plan) => {
      const { stdout, status } = run([plan, "1"]);
      expect(status).toBe(0);
      expect(stdout).toContain("Active task 1: Already done");
      expect(stdout).toMatch(/package\.json — exists/);
      // Task 1's file block only lists package.json — not the sentinel.
      expect(stdout).not.toContain("__ci_nonexistent_sentinel__");
    });
  });

  it("prints the vacuum MCP orientation tip", () => {
    withFixture((plan) => {
      expect(run([plan]).stdout).toContain("find_symbol");
    });
  });

  it("exits 2 when the plan file is missing", () => {
    expect(run(["/no/such/plan.md"]).status).toBe(2);
  });

  it("exits 2 when the requested task number is not in the plan", () => {
    withFixture((plan) => {
      expect(run([plan, "99"]).status).toBe(2);
    });
  });

  it("exits 1 on a usage error (no arguments)", () => {
    expect(run([]).status).toBe(1);
  });
});
