import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface DescribeTableArgs extends DatabaseScopedArgs {
  readonly table: string;
}

/**
 * The shape of one table, in each engine's terms.
 *
 * Columns on SQL engines, fields inferred from sampled documents on MongoDB,
 * the mapping on Elasticsearch, and type, TTL and size for a Redis key.
 */
export class DescribeTableTool extends DatabaseScopedTool<DescribeTableArgs> {
  public readonly name = "describe_table";
  public readonly description =
    "Show the structure of a table: columns on SQL engines, inferred fields for a MongoDB collection, the mapping of an Elasticsearch index, or the type and TTL of a Redis key";

  public readonly annotations: ToolHints = {
    title: "Describe Table",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    table: z
      .string()
      .describe("Table name (schema.table where the engine has schemas), collection, Redis key, or index"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(drivers: DriverProvider, names: NamePolicyRegistry) {
    super(drivers, names);
  }

  protected async read(args: DescribeTableArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.validateObjectName(target, args.table, "table name");
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquire(target);
    return ToolResponse.json(await driver.describeObject(args.table));
  }
}
