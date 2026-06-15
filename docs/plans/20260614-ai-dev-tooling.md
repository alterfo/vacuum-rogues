---
# AI Developer Tooling — Reduce Context, Eliminate Lockstep Bugs

## Overview
Three root causes of Sonnet bugs and context overflow in this codebase:
1. **No fast lookup** — finding where `QuestType` is defined costs 5 grep calls and 3 file reads
2. **Lockstep edits** — adding a domain field requires touching 6 files manually; missing one breaks saves
3. **Dense CLAUDE.md** — flight module rules (6.8 KB) + traps load on every flight task

Fix: (A) an MCP server that answers "where is X?" in one tool call, (B) code generators for
domain fields, scenes, and quest types that produce all 4–6 required files atomically, and
(C) CLAUDE.md refactoring that makes per-task context under 2 KB.

This plan does NOT touch game logic — only developer tooling under `tools/` and `.claude/`.

## Context
- Audit findings:
  - `SpaceFlightScene.ts`: 1,901 lines; `PlanetScene.ts`: 1,465; `StationScene.ts`: 1,403
  - Domain field → 6 lockstep files; quest type → 20+ files; new scene → 5 files
  - `.claude/settings.json` has 0 MCP servers, 0 hooks; prompts are Russian-only templates
  - `src/presentation/flight/CLAUDE.md`: 6,861 chars loaded on every flight task
  - Test coverage: `StationScene.ts` (1,403 lines) has no dedicated test file
- No existing MCP setup; project uses `@modelcontextprotocol/sdk` ecosystem (npm available)
- TypeScript + tsx available (`npx tsx`); no Python dependency needed for tooling
- ralphex runs Claude CLI in subshells; MCP servers registered in `.claude/settings.json`
  are available in those subshells automatically

## Development Approach
- Each task is pure tooling — no game logic touched, no schema migrations
- Tests for generators use snapshot testing (generate → assert output matches expected)
- Regular approach (code first, tests confirm output)
- `npm run lint` must stay green (tools/ is outside src/ but linted if included in tsconfig)

## Implementation Steps

### Task 1: MCP server — fast symbol and architecture lookup
**Files:**
- Create: `tools/mcp/vacuum-mcp.ts`
- Create: `tools/mcp/package.json` (minimal, reuses workspace node_modules)
- Modify: `.claude/settings.json` (register MCP server)
- Create: `tools/mcp/vacuum-mcp.test.ts`

**What it does:** a lightweight MCP server Sonnet can query at the START of any task
instead of reading 5 files to orient. Wraps existing shell commands in typed tools.

**Tools to expose:**
```
find_symbol(name: string)
  → runs: grep -rn "export.*<name>\|class <name>\|interface <name>\|type <name>" src/
  → returns: "src/types/index.ts:324"

find_tests_for(srcPath: string)
  → runs: grep -rln "import.*<basename>" src/tests/
  → returns: ["src/tests/QuestManager.test.ts"]

get_architecture()
  → returns hardcoded JSON: { layers, key_entry_points, lockstep_rules }
  → static, read from tools/mcp/architecture.json

get_balance_constants()
  → runs: node -e "import('./src/config/balance.ts').then(m => console.log(JSON.stringify(m)))"
  → returns all constants as JSON (numbers only, no PixiJS deps)

get_scene_info(sceneName: string)
  → runs: grep -n "initialize\|update\|destroy\|transitionTo" src/presentation/<sceneName>.ts
  → returns key lifecycle lines without reading the whole file
```

- [x] Create `tools/mcp/vacuum-mcp.ts` using `@modelcontextprotocol/sdk/server` with the
  5 tools above; use `StdioServerTransport`; all tools shell-exec with `child_process.execFileSync`
  (sync is fine — MCP calls are blocking by design; execFileSync avoids shell injection).
  Pure logic split into `tools/mcp/tools.ts` (SDK-free) so smoke tests run without the protocol.
- [x] Create `tools/mcp/architecture.json` with the static layer map, lockstep rules,
  and entry points (hand-authored from CLAUDE.md content, ~50 lines of JSON)
- [x] Register in `.claude/settings.json`:
  ```json
  "mcpServers": {
    "vacuum": {
      "command": "npx",
      "args": ["tsx", "tools/mcp/vacuum-mcp.ts"]
    }
  }
  ```
- [x] Write smoke tests: call each tool function directly (not via MCP protocol), assert
  `find_symbol("QuestType")` returns a string containing "src/types/index.ts",
  `find_tests_for("src/systems/QuestManager.ts")` returns non-empty array,
  `get_balance_constants()` returns object with `STARTING_MONEY: 1000`
- [x] Run lint + tests — green

### Task 2: Domain field generator — atomically touch all 6 lockstep files
**Files:**
- Create: `tools/scaffold/domain-field.ts`
- Create: `tools/scaffold/domain-field.test.ts`

**Usage:**
```bash
npx tsx tools/scaffold/domain-field.ts --entity Player --field techResearch --type number --default 0
```

**What it produces atomically:**
1. Inserts `readonly techResearch: number = 0;` into the domain class constructor
2. Inserts `techResearch: z.number().int().min(0).default(0),` into the Zod schema
3. Appends a migration stub to `MigrationPipeline.ts` at the latest version
4. Prints a checklist of manual steps remaining (adding to SaveStateSerializer if needed)

- [x] Implement `domain-field.ts`: parse `--entity`, `--field`, `--type`, `--default` args;
  use regex-based AST-free insertion (find the last `readonly` field in the class, insert after;
  find the Zod schema object closing, insert before `}`); read current migration version from
  `MigrationPipeline.ts` and append migration stub at version N+1
- [x] Handle error cases: entity file not found, field already exists (no-op with warning),
  schema not found
- [x] Write tests using a temp directory: copy fixture files (minimal Player.ts + schemas.ts +
  MigrationPipeline.ts stubs), run generator, assert all 3 files are correctly modified;
  assert idempotent (running twice doesn't duplicate the field)
- [x] Run lint + tests — green
- [x] Verify manually: run on a REAL entity (`Player`, field `testField`, type `number`, default `0`),
  confirm `npm test -- --run` still passes, then revert

### Task 3: Scene generator — atomically touch all 5 scene registration files
**Files:**
- Create: `tools/scaffold/new-scene.ts`
- Create: `tools/scaffold/new-scene.test.ts`

**Usage:**
```bash
npx tsx tools/scaffold/new-scene.ts --name ResearchUpgrade --context-dependent
```

**What it produces atomically:**
1. `src/presentation/ResearchUpgradeScene.ts` — class stub extending GameScene with
   `initialize()`, `update(dt)`, `destroy()` and a TODO comment
2. Inserts `RESEARCH_UPGRADE = "RESEARCH_UPGRADE"` into `SceneType` enum in `src/types/index.ts`
3. Inserts `case SceneType.RESEARCH_UPGRADE: return new ResearchUpgradeScene(ctx);` into
   `src/core/services/SceneFactory.ts`
4. If `--context-dependent`: inserts `SceneType.RESEARCH_UPGRADE` into `contextDependentScenes`
   array in `GameEngine.ts`
5. `e2e/page-objects/ResearchUpgradeScenePage.ts` — empty Page Object stub

- [ ] Implement `new-scene.ts`: generate scene stub from template string; insert SceneType enum
  value (find `= "LAST_VALUE"` pattern, insert after); insert SceneFactory case (find closing
  `default:` of switch); optionally insert into contextDependentScenes array
- [ ] Write tests: run generator into temp dir, assert all 5 outputs exist and contain
  expected class/enum/case strings; assert SceneFactory has the new case; assert GameEngine
  contextDependentScenes contains the new type when `--context-dependent` is passed
- [ ] Run lint + tests — green

### Task 4: Slim CLAUDE.md files — under 1 KB each, playtest traps in separate reference files
**Files:**
- Modify: `src/presentation/flight/CLAUDE.md` (6.8 KB → < 1 KB)
- Modify: `src/presentation/CLAUDE.md` (5.8 KB → < 1.5 KB)
- Create: `src/presentation/flight/playtest-traps.md` (reference, not auto-loaded)
- Create: `src/presentation/pixi-rules.md` (PixiJS 8 gotchas reference, not auto-loaded)
- Modify: `e2e/CLAUDE.md` (3.4 KB → < 800 chars)

**Principle:** CLAUDE.md = what you must know to START; reference files = look up when stuck.
Sonnet should be able to work without the reference files and only read them when it hits
a specific problem.

- [ ] Rewrite `src/presentation/flight/CLAUDE.md` to ≤ 1,000 chars: one-line description of
  each module, the critical line-count guard (`SpaceFlightScene < 1,900 lines`), and ONE
  sentence pointing to `playtest-traps.md` for historical bugs
- [ ] Extract all playtest trap content from the current flight CLAUDE.md into
  `src/presentation/flight/playtest-traps.md` (unchanged content, just relocated)
- [ ] Rewrite `src/presentation/CLAUDE.md` to ≤ 1,500 chars: list the 3 most-commonly-hit
  PixiJS rules (hitArea, mask must be addChild'd, eventMode on Text), point to
  `pixi-rules.md` for the full list
- [ ] Extract the 9-rule PixiJS list + texture loading convention into `src/presentation/pixi-rules.md`
- [ ] Rewrite `e2e/CLAUDE.md` to ≤ 800 chars: only the 2 critical rules
  (real pointer events for interaction bugs; dev server on 5175 not 5173)
- [ ] Verify char counts: `wc -c src/presentation/flight/CLAUDE.md` < 1,000;
  `wc -c src/presentation/CLAUDE.md` < 1,500; `wc -c e2e/CLAUDE.md` < 800
- [ ] Run lint — green (CLAUDE.md files aren't linted but ensure no broken @-references)

### Task 5: Task-scoped context injection for ralphex — pre-read Files: block
**Files:**
- Create: `.ralphex/prompts/task.txt` (ralphex custom task prompt override)
- Create: `tools/context-inject.sh` (helper script)

**Problem:** Each ralphex task iteration starts fresh. The task prompt says "fix X" but Sonnet
has to re-read 4 files to remember what X looks like. If the plan already lists `**Files:**`,
ralphex should pre-populate those files' content.

**Solution:** Customize the ralphex task prompt to instruct Sonnet to call the MCP
`find_symbol` tool FIRST, before reading any files, to get precise line numbers — then read
only the needed line ranges, not whole files.

- [ ] Check if `.ralphex/prompts/task.txt` already exists; if not, extract the default from
  ralphex's bundled prompts (`~/.claude/plugins/cache/ralphex/*/assets/prompts/make_task.txt`)
- [ ] Add a preamble to the task prompt (prepend, don't replace):
  ```
  BEFORE reading any source files:
  1. Use the `vacuum` MCP tool `find_symbol` to locate key types/classes mentioned in the task
  2. Use `get_architecture` to confirm which layer owns the change
  3. Read only the line ranges you need, not entire files
  4. If the task has a **Files:** section, read only those files (not the whole codebase)
  ```
- [ ] Test: run ralphex with a simple 1-task plan, observe in progress log that MCP tool
  is called before file reads (manual verification from progress file output)
- [ ] No automated test possible (requires ralphex runtime); document expected behavior
  in a comment in the prompt file

### Task 6: Verify tooling works end-to-end
**Files:** all created above

- [ ] Run `npx tsx tools/scaffold/new-scene.ts --name TestScene` → 5 files created/modified
- [ ] Run `npx tsx tools/scaffold/domain-field.ts --entity Player --field testPing --type boolean --default false`
  → 3 files modified; `npm test -- --run` green; revert changes
- [ ] Start MCP server: `npx tsx tools/mcp/vacuum-mcp.ts` → no crash
- [ ] Call MCP from Claude: ask "use vacuum MCP to find where QuestType is defined"
  → returns file:line in one call
- [ ] Confirm CLAUDE.md sizes: all within budget
- [ ] Run `npm run lint` — zero errors
- [ ] Run `npm test -- --run` — green (tooling tests pass)

### Task 7: [Final] Document the tooling
**Files:**
- Create: `tools/README.md`
- Modify: `CLAUDE.md` root (add 3-line "tooling" section)

- [ ] Write `tools/README.md`: one paragraph each on vacuum-mcp, domain-field generator,
  new-scene generator; example commands; when to use each
- [ ] Add to root `CLAUDE.md` under new "## Tooling" section (≤ 200 chars):
  `vacuum MCP`, `scaffold/domain-field.ts`, `scaffold/new-scene.ts` — one-line each

## Technical Details

**MCP server architecture:**
```
tools/mcp/vacuum-mcp.ts
  McpServer("vacuum", { version: "1.0.0" })
  ├── tool: find_symbol(name)       → grep -rn "export.*name|class name" src/
  ├── tool: find_tests_for(path)    → grep -rln "import.*basename" src/tests/
  ├── tool: get_architecture()      → read tools/mcp/architecture.json
  ├── tool: get_balance_constants() → import src/config/balance.ts via tsx
  └── tool: get_scene_info(name)    → grep key lifecycle lines only
```

**Generator insertion strategy (regex-based, no AST):**
```
domain-field.ts:
  find "readonly <last_field>: " → insert after the line
  find "export const <Entity>Schema = z.object({" → find closing }) → insert before
  find "const migrations: Migration[]" → find last element → insert after

new-scene.ts:
  SceneType: find last `= "..."` in enum → insert after
  SceneFactory: find `default:` case → insert before
  GameEngine contextDependentScenes: find array closing ] → insert before
```

**Context budget per task (target):**
```
Before tooling:  task description + CLAUDE.md files + 5 source files ≈ 35–50 KB tokens
After tooling:   task description + slim CLAUDE.md (< 3 KB) + MCP lookups (< 1 KB) ≈ 8–12 KB tokens
```

## Post-Completion

**Manual verification:**
- Open a new Claude Code session (clean context), ask "where is NpcRole defined?" — expect
  it to use vacuum MCP instead of searching manually
- Start a ralphex run for a small plan; check progress log for MCP tool calls before file reads
- Run `npx tsx tools/scaffold/new-scene.ts --name FooScene` and verify the 5 files are
  consistent (no missing enum entry, no missing SceneFactory case)

**Future work (out of scope):**
- Quest-type generator: `new-quest-type.ts --type ESCORT` (touches 20+ files; complex)
- Auto-indexing: a git hook that regenerates `architecture.json` on schema changes
- Per-file summaries: pre-generate a 2-sentence summary of each major source file,
  stored in `tools/mcp/file-summaries.json`, served by the MCP `get_file_summary` tool
- StationScene.ts / PlanetScene.ts split into sub-modules (separate refactor plan)
