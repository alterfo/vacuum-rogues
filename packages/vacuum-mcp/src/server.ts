import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSymbolText, findTestsFor } from "./find-symbol.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ServerOptions {
  root?: string;
  architectureFile?: string;
  searchDirs?: string[];
}

export function createServer(options: ServerOptions = {}): McpServer {
  const root = options.root ?? process.cwd();
  const searchDirs = options.searchDirs ?? ["src", "."];

  const server = new McpServer({ name: "vacuum-mcp", version: "1.0.0" });

  server.registerTool(
    "find_symbol",
    {
      description:
        "Return the FULL source body of a declared symbol (class, function, enum, type, " +
        "interface, const, def, type alias). Uses grep to find candidate files, then " +
        "ast-grep to extract the complete declaration. Supports TypeScript, JavaScript, " +
        "Python, and Go. Use this FIRST instead of reading entire files.",
      inputSchema: {
        name: z.string().describe("Symbol name, e.g. QuestType or buildLocalDelivery"),
        langs: z
          .array(z.enum(["ts", "tsx", "js", "jsx"]))
          .optional()
          .describe("Limit to specific languages (default: all)"),
      },
    },
    ({ name, langs }) =>
      textResult(findSymbolText(name, root, { searchDirs, langs })),
  );

  server.registerTool(
    "find_tests_for",
    {
      description:
        "List test/spec files that import the given source file by basename. " +
        "Pass a path like 'src/systems/QuestManager.ts'.",
      inputSchema: {
        srcPath: z
          .string()
          .describe("Source file path, e.g. src/systems/QuestManager.ts"),
      },
    },
    ({ srcPath }) => textResult(findTestsFor(srcPath, root)),
  );

  if (options.architectureFile) {
    const archPath = resolve(root, options.architectureFile);
    server.registerTool(
      "get_architecture",
      {
        description:
          "Return the project architecture map: layer structure, key entry points, " +
          "dependency rules, and lockstep files.",
        inputSchema: {},
      },
      () => {
        const json = readFileSync(archPath, "utf8");
        return textResult(JSON.parse(json));
      },
    );
  }

  return server;
}

function textResult(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text" as const, text }] };
}
