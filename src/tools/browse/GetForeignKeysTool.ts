import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface GetForeignKeysArgs extends DatabaseScopedArgs {
  readonly table: string;
}

/** Foreign keys declared on one table, on the relational engines that have them. */
export class GetForeignKeysTool extends DatabaseScopedTool<GetForeignKeysArgs> {
  public readonly name = "get_foreign_keys";
  public readonly description =
    "Show foreign key relationships for a table on MySQL, PostgreSQL, SQLite or SQL Server";

  public readonly annotations: ToolHints = {
    title: "Get Foreign Keys",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    table: z.string().describe("Table name"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(drivers: DriverProvider, names: NamePolicyRegistry) {
    super(drivers, names);
  }

  protected async read(args: GetForeignKeysArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.validateObjectName(target, args.table, "table name");
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquire(target);
    const rows = await driver.listForeignKeys(args.table);

    // A sentence rather than []: an empty array reads as "the query failed",
    // a sentence reads as an answer.
    if (rows.length === 0) {
      return ToolResponse.text(`No foreign keys found for table "${args.table}".`);
    }

    return ToolResponse.json(rows);
  }
}
