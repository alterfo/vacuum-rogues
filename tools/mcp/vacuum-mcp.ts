/**
 * vacuum-mcp — a lightweight Model Context Protocol server for this codebase.
 *
 * Purpose: let an agent orient at the START of a task with ONE tool call instead
 * of reading 5 files. Each tool wraps a cheap shell/import lookup (see tools.ts).
 *
 * Run standalone:  npx tsx tools/mcp/vacuum-mcp.ts
 * Registered for Claude Code in project-root .mcp.json under mcpServers.vacuum
 * (settings.json only sets enableAllProjectMcpServers to auto-approve it).
 *
 * The tool logic lives in tools.ts (SDK-free) so it stays unit-testable without
 * the MCP transport. This file only wires those functions to the protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  findSymbol,
  findTestsFor,
  getArchitecture,
  getBalanceConstants,
  getSceneInfo,
} from "./tools.js";

function textResult(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "vacuum", version: "1.0.0" });

  server.registerTool(
    "find_symbol",
    {
      description:
        "Locate where a type/class/interface/enum/const/function is declared in src/. " +
        "Returns matching 'file:line: text' lines. Use this FIRST instead of grepping.",
      inputSchema: { name: z.string().describe("Symbol name, e.g. QuestType") },
    },
    ({ name }) => textResult(findSymbol(name)),
  );

  server.registerTool(
    "find_tests_for",
    {
      description:
        "List test files under src/tests/ that import the given source file (by basename). " +
        "Pass a path like 'src/systems/QuestManager.ts'.",
      inputSchema: {
        srcPath: z.string().describe("Source file path, e.g. src/systems/QuestManager.ts"),
      },
    },
    ({ srcPath }) => textResult(findTestsFor(srcPath)),
  );

  server.registerTool(
    "get_architecture",
    {
      description:
        "Return the static layer map, dependency rule, key entry points and lockstep rules. " +
        "Use this to confirm which layer owns a change before editing.",
      inputSchema: {},
    },
    () => textResult(getArchitecture()),
  );

  server.registerTool(
    "get_balance_constants",
    {
      description:
        "Return game balance constants from src/config/balance.ts as flat JSON (numbers only).",
      inputSchema: {},
    },
    async () => textResult(await getBalanceConstants()),
  );

  server.registerTool(
    "get_scene_info",
    {
      description:
        "Return the key lifecycle lines (initialize/update/destroy/transitionTo) of a scene " +
        "without reading the whole file. Pass a scene class name, e.g. PlanetScene.",
      inputSchema: {
        sceneName: z.string().describe("Scene class name, e.g. PlanetScene"),
      },
    },
    ({ sceneName }) => textResult(getSceneInfo(sceneName)),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stays connected over stdio until the host disconnects.
}

// Only start the server when run directly (not when imported by a test).
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[vacuum-mcp] fatal:", err);
    process.exit(1);
  });
}
