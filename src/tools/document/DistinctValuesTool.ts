import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { DocumentTool, type DocumentArgs } from "./DocumentTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { RowFormatter } from "../../formatting/RowFormatter.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { MongoOperatorGuard } from "../../validation/document/MongoOperatorGuard.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { ToolResult } from "../../types/tool.types.js";

interface DistinctValuesArgs extends DocumentArgs {
  readonly field: string;
  readonly filter: Record<string, unknown>;
}

/** The distinct values of one field: how people find out what a status column holds. */
export class DistinctValuesTool extends DocumentTool<DistinctValuesArgs> {
  public readonly name = "distinct_values";
  public readonly description =
    "List the distinct values of a field in a MongoDB collection, optionally within a filter";

  public readonly annotations: ToolHints = {
    title: "List Distinct Values",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    collection: DocumentTool.collectionParam,
    field: z.string().min(1).describe("Field path, e.g. status or address.city"),
    filter: DocumentTool.filterParam,
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    drivers: DriverProvider,
    names: NamePolicyRegistry,
    guard: MongoOperatorGuard,
    private readonly rows: RowFormatter
  ) {
    super(drivers, names, guard);
  }

  protected async read(args: DistinctValuesArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.checkInputs(target, args.collection, { filter: args.filter });
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquireDocument(target, this.name);
    const values = await driver.distinct(args.collection, args.field, args.filter);
    return ToolResponse.text(this.rows.format(values, "Narrow the filter"));
  }
}
