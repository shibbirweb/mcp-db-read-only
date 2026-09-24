import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface GetTableIndexesArgs extends DatabaseScopedArgs {
  readonly table: string;
}

/** Indexes on one table or collection. */
export class GetTableIndexesTool extends DatabaseScopedTool<GetTableIndexesArgs> {
  public readonly name = "get_table_indexes";
  public readonly description =
    "Show indexes on a table or MongoDB collection, or the sorting key and skipping indices of a ClickHouse table";

  public readonly annotations: ToolHints = {
    title: "Get Table Indexes",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    table: z.string().describe("Table or collection name"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(drivers: DriverProvider, names: NamePolicyRegistry) {
    super(drivers, names);
  }

  protected async read(args: GetTableIndexesArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.validateObjectName(target, args.table, "table name");
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquire(target);
    return ToolResponse.json(await driver.listIndexes(args.table));
  }
}
