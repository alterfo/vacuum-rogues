# vacuum-mcp

MCP server that returns **full symbol bodies** from source files — not just the line where a symbol is declared, but the entire function/class/enum text.

Uses a hybrid approach: grep to locate candidate files (fast), then [ast-grep](https://ast-grep.github.io/) to parse and extract the complete AST node.

**Supports:** TypeScript · JavaScript · Python · Go

**Zero daemon** — no tsserver, no LSP, no language server to start. Works offline.

## Why

When an AI agent needs to understand a function, reading the full file is expensive. Returning just the declaration line leaves out the body. `vacuum-mcp` bridges the gap: one tool call, full body, exact line range.

## Installation

```bash
npm install -g vacuum-mcp
# or use without installing:
npx vacuum-mcp
```

## Usage

### As an MCP server (Claude Code / Cursor / other agents)

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "vacuum": {
      "command": "npx",
      "args": ["vacuum-mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

The server exposes two tools:

| Tool | Description |
|------|-------------|
| `find_symbol` | Returns full body of a declared symbol |
| `find_tests_for` | Lists test files that import a given source file |

### Optional: architecture map

If you place a `vacuum.config.json` (or `.vacuum.json`) in your project root, a third tool `get_architecture` becomes available, returning its contents. Use this to give your agent a static layer map / entry-point reference.

### CLI mode

```bash
# Print full body of a symbol to stdout
npx vacuum-mcp find MyClass

# Limit to TypeScript files
npx vacuum-mcp find buildWidget --lang ts

# Multiple languages
npx vacuum-mcp find handler --lang ts,js
```

## Programmatic API

```typescript
import { findSymbol, findSymbolText, findTestsFor, createServer } from "vacuum-mcp";

// Returns array of matches with full body text + line range
const matches = findSymbol("QuestType", process.cwd(), { searchDirs: ["src"] });
// [{ file: "src/types/index.ts", startLine: 60, endLine: 71, text: "enum QuestType { ... }" }]

// Formatted string ready for display
const text = findSymbolText("CombatModule", process.cwd());

// Create a custom MCP server (e.g. to add project-specific tools on top)
const server = createServer({
  root: process.cwd(),
  architectureFile: "vacuum.config.json",
  searchDirs: ["src", "lib"],
});
```

## Configuration

`createServer` options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `root` | `string` | `process.cwd()` | Project root |
| `architectureFile` | `string` | — | Path to architecture JSON (enables `get_architecture` tool) |
| `searchDirs` | `string[]` | `["src", "."]` | Directories to search inside root |

## How it works

1. **grep** scans only candidate files matching the declaration pattern for the symbol name (one `grep -rl` per language, milliseconds)
2. **ast-grep** parses each candidate file, walks the AST by node kind (`function_declaration`, `class_declaration`, etc.), and matches by identifier text
3. Returns `node.text()` — the verbatim source of the complete declaration

This is 10–50× faster than parsing every file upfront, and works on repos with thousands of source files.

## License

MIT
