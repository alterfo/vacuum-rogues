# Developer Tooling

Helpers that reduce the context an agent must load and eliminate lockstep-edit
bugs (adding a field/scene means touching several files in sync — miss one and
saves or "Continue" break). All of this lives under `tools/` and `.claude/`; none
of it touches game logic. See `docs/plans/20260614-ai-dev-tooling.md` for the
rationale.

## vacuum MCP — fast "where is X?" lookup

`tools/mcp/vacuum-mcp.ts` is a Model Context Protocol server that lets an agent
orient at the **start** of a task with one tool call instead of reading five
files. It is registered for Claude Code in `.claude/settings.json`
(`mcpServers.vacuum`) and is available automatically inside ralphex subshells.
The tool logic is split into `tools/mcp/tools.ts` (SDK-free, so smoke tests run
without the protocol); `architecture.json` holds the static layer map. Tools:

- `find_symbol(name)` — where a type/class/interface/enum/const/function is
  declared (`src/types/index.ts:60:export enum QuestType {`). Use this instead of grepping.
- `find_tests_for(srcPath)` — test files under `src/tests/` that import a source file.
- `get_architecture()` — layer map, dependency rule, key entry points, lockstep rules.
- `get_balance_constants()` — `src/config/balance.ts` constants as flat JSON.
- `get_scene_info(sceneName)` — the lifecycle lines of a scene without reading the whole file.

**When to use:** at the beginning of any task, to locate code and confirm which
layer owns a change, before reading files.

```bash
npx tsx tools/mcp/vacuum-mcp.ts   # run standalone (normally launched by the MCP host)
npm test -- --run tools/mcp/vacuum-mcp.test.ts
```

## scaffold/domain-field.ts — add a domain field across all lockstep files

`tools/scaffold/domain-field.ts` adds a field to a domain entity by editing every
file that must change in lockstep — the domain class (`src/domain/<Entity>.ts`),
the Zod schema (`src/validation/schemas.ts`), and a migration step
(`src/data/MigrationPipeline.ts`) — then prints any manual follow-up. Insertion
is regex/brace-counting based (no AST, no TypeScript compiler dependency) and is
idempotent: running it twice does not duplicate the field. It also handles
missing files / fields gracefully with warnings.

**When to use:** whenever you would otherwise follow the "New Domain Field" steps
in `CLAUDE.md` by hand.

```bash
npx tsx tools/scaffold/domain-field.ts --entity Player --field techResearch --type number --default 0
npm test -- --run tools/scaffold/domain-field.test.ts
```

## scaffold/new-scene.ts — register a new scene across all 5 files

`tools/scaffold/new-scene.ts` creates a PixiJS scene and wires it into every
registration point: the scene class (`src/presentation/<Name>Scene.ts`), the
`SceneType` enum (`src/types/index.ts`), the `SceneFactory` import+case
(`src/core/services/SceneFactory.ts`), the E2E Page Object
(`e2e/page-objects/<Name>ScenePage.ts`), and — with `--context-dependent` —
`GameEngine.contextDependentScenes` (so "Continue" falls back to SPACE_FLIGHT
instead of a blank screen). Pass the base name **without** the `Scene` suffix;
the tool appends it. Like the domain-field generator it is regex-based and
idempotent.

**When to use:** instead of the manual "New Scene" checklist in
`.claude/docs/adding-features.md`.

```bash
npx tsx tools/scaffold/new-scene.ts --name ResearchUpgrade --context-dependent
npm test -- --run tools/scaffold/new-scene.test.ts
```

## context-inject.sh — surface a ralphex task's Files: block

`tools/context-inject.sh <plan-file> [task-number]` prints the active task's
title and its `**Files:**` block with each file's on-disk status (line count or
"to be created"), so a cold ralphex iteration can jump straight to the right
files. Defaults to the first task with an unchecked `[ ]` box. Pair it with the
vacuum `find_symbol` tool; the orientation workflow lives in
`.ralphex/prompts/task.txt`.
