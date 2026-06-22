#!/usr/bin/env node
/**
 * vacuum-mcp CLI entry point.
 *
 * Usage:
 *   npx vacuum-mcp                           # start as MCP server (stdio)
 *   npx vacuum-mcp find MySymbol            # print symbol body to stdout
 *   npx vacuum-mcp find MySymbol --lang ts  # limit to TypeScript files
 *
 * MCP server mode (default) is used by Claude Code, Cursor, and other agents
 * via .mcp.json / mcp_servers configuration.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../src/server.js";
import { findSymbolText } from "../src/find-symbol.js";
import type { SupportedLang } from "../src/find-symbol.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const root = process.cwd();

// Detect optional architecture config
const archCandidates = ["vacuum.config.json", ".vacuum.json", "vacuum.json"];
const architectureFile = archCandidates.find((f) => existsSync(resolve(root, f)));

// CLI: "find <Name> [--lang ts,js,...]"
if (args[0] === "find" && args[1]) {
  const name = args[1];
  const langArg = args.indexOf("--lang");
  const langs =
    langArg !== -1
      ? (args[langArg + 1]?.split(",").filter((l) =>
          ["ts", "tsx", "js", "jsx"].includes(l),
        ) as SupportedLang[])
      : undefined;
  console.log(findSymbolText(name, root, { langs }));
  process.exit(0);
}

// Default: run as MCP server over stdio
const server = createServer({ root, architectureFile });
const transport = new StdioServerTransport();
await server.connect(transport);
