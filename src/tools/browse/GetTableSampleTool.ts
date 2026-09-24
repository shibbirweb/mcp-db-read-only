import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface GetTableSampleArgs extends DatabaseScopedArgs {
  readonly table: string;
  readonly limit: number;
}

/** A handful of real rows, documents, hits, or the start of a Redis value. */
export class GetTableSampleTool extends DatabaseScopedTool<GetTableSampleArgs> {
  public readonly name = "get_table_sample";
  public readonly description =
    "Get sample rows from a table, documents from a collection, hits from an index, or the first entries of a Redis key";

  private static readonly MIN_LIMIT = 1;
  private static readonly MAX_LIMIT = 50;

  public readonly annotations: ToolHints = {
    title: "Get Table Sample",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    table: z.string().describe("Table, collection, index, or Redis key"),
    limit: z
      .number()
      .min(GetTableSampleTool.MIN_LIMIT)
      .max(GetTableSampleTool.MAX_LIMIT)
      .default(5)
      .describe("Number of rows to return (1-50, default 5)"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(drivers: DriverProvider, names: NamePolicyRegistry) {
    super(drivers, names);
  }

  protected async read(args: GetTableSampleArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.validateObjectName(target, args.table, "table name");
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquire(target);
    return ToolResponse.json(await driver.sample(args.table, this.clampLimit(args.limit)));
  }

  /**
   * Some drivers interpolate the limit, because not every engine accepts a
   * placeholder in LIMIT.
   *
   * Clamping here duplicates the Zod constraint on purpose. The schema is
   * enforced by the client before dispatch; clamping in the handler means a
   * value reaching a query string cannot be anything but an integer in range,
   * however it got here.
   */
  private clampLimit(limit: number): number {
    return Math.min(
      Math.max(Math.trunc(limit), GetTableSampleTool.MIN_LIMIT),
      GetTableSampleTool.MAX_LIMIT
    );
  }
}
