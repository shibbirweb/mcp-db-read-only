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

interface AggregateArgs extends DocumentArgs {
  readonly pipeline: Record<string, unknown>[];
}

/**
 * A MongoDB aggregation pipeline: MongoDB's equivalent of run_query.
 *
 * Checked twice, by two different mechanisms: MongoOperatorGuard here refuses
 * `$out`, `$merge` and server-side JavaScript anywhere in the pipeline, and
 * the driver's MongoStageAllowlist refuses any stage it does not recognise as
 * a read.
 */
export class AggregateTool extends DocumentTool<AggregateArgs> {
  public readonly name = "aggregate";
  public readonly description =
    "Run a read-only MongoDB aggregation pipeline on a collection ($out and $merge are not allowed)";

  public readonly annotations: ToolHints = {
    title: "Run Aggregation Pipeline",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    collection: DocumentTool.collectionParam,
    pipeline: z
      .array(z.record(z.unknown()))
      .describe('Pipeline stages as Extended JSON, e.g. [{"$match": {"status": "active"}}, {"$group": {"_id": "$type", "n": {"$sum": 1}}}]'),
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

  protected async read(args: AggregateArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.checkInputs(target, args.collection, { pipeline: args.pipeline });
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquireDocument(target, this.name);
    const result = await driver.aggregate(args.collection, args.pipeline, this.rows.limit);

    return ToolResponse.text(
      this.rows.format(result.rows, "Add a $limit stage or a narrower $match", result.truncated)
    );
  }
}
