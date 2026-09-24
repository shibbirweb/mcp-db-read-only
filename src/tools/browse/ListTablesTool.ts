import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface ListTablesArgs extends DatabaseScopedArgs {
  readonly pattern?: string;
}

/** Lists tables, collections, keys or indices, whichever the engine has. */
export class ListTablesTool extends DatabaseScopedTool<ListTablesArgs> {
  public readonly name = "list_tables";
  public readonly description =
    "List the tables in the active database: collections on MongoDB, keys on Redis, indices on Elasticsearch";

  /**
   * Enough to see what is there on any real schema. The cap matters most on
   * Redis, where "tables" are keys and a production instance holds millions.
   */
  private static readonly MAX_NAMES = 1000;

  public readonly annotations: ToolHints = {
    title: "List Tables",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    pattern: z
      .string()
      .optional()
      .describe("Optional glob filter, * for any characters and ? for one, e.g. user* or logs-2026-*"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(drivers: DriverProvider, names: NamePolicyRegistry) {
    super(drivers, names);
  }

  protected async read(args: ListTablesArgs, target: ConnectionTarget): Promise<ToolResult> {
    if (args.pattern) {
      const rejection = this.reject(this.names.for(target.engine).validatePattern(args.pattern));
      if (rejection) {
        return rejection;
      }
    }

    const driver = await this.drivers.acquire(target);
    const listing = await driver.listObjects(args.pattern, ListTablesTool.MAX_NAMES);

    const noun = EngineCatalog.describe(target.engine).objectNoun;
    const heading = `${this.plural(noun)} (${listing.names.length}${listing.truncated ? "+" : ""})`;
    const note = listing.truncated
      ? `\n\n--- Showing the first ${listing.names.length}. Pass a pattern to narrow the list. ---`
      : "";

    return ToolResponse.text(`${heading}:\n${listing.names.join("\n")}${note}`);
  }

  private plural(noun: string): string {
    const capitalised = `${noun[0].toUpperCase()}${noun.slice(1)}`;
    return noun === "index" ? "Indices" : `${capitalised}s`;
  }
}
