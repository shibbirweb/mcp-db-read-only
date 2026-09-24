import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { RowFormatter } from "../../formatting/RowFormatter.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import { SqlValidatorRegistry } from "../../validation/sql/SqlValidatorRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface RunQueryArgs extends DatabaseScopedArgs {
  readonly query: string;
}

/**
 * The general escape hatch for reads on the SQL engines.
 *
 * No parameter binding is exposed. Adding a `params` argument would let an
 * assistant separate values from SQL properly, but models inline their values
 * in practice, and the validator plus each driver's server-side read-only
 * mode already bound what a query can do.
 */
export class RunQueryTool extends DatabaseScopedTool<RunQueryArgs> {
  public readonly name = "run_query";
  public readonly description =
    "Execute a read-only SQL query (SELECT, WITH, and the engine's SHOW, DESCRIBE or EXPLAIN) on a MySQL, MariaDB, PostgreSQL, SQLite, SQL Server or ClickHouse connection";

  protected override readonly family = "sql" as const;

  public readonly annotations: ToolHints = {
    title: "Run Read-Only SQL Query",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    query: z.string().describe("SQL query to execute, in the active engine's dialect"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    drivers: DriverProvider,
    names: NamePolicyRegistry,
    private readonly validators: SqlValidatorRegistry,
    private readonly rows: RowFormatter
  ) {
    super(drivers, names);
  }

  protected async read(args: RunQueryArgs, target: ConnectionTarget): Promise<ToolResult> {
    const driver = await this.drivers.acquireSql(target, this.name);

    // Validation happens before anything touches the network, so a rejected
    // query costs no connection. The dialect comes from the driver, so a
    // PostgreSQL query is lexed as PostgreSQL, dollar quotes and all.
    const check = this.validators.for(driver.dialect).validate(args.query);
    if (!check.valid) {
      return ToolResponse.failure(check.error ?? "Query rejected.");
    }

    const result = await driver.query(args.query);
    return ToolResponse.text(this.rows.format(result, "Add a LIMIT clause (TOP on SQL Server)"));
  }
}
