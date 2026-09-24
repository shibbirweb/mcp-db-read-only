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

interface FindDocumentsArgs extends DocumentArgs {
  readonly filter: Record<string, unknown>;
  readonly projection?: Record<string, unknown>;
  readonly sort?: Record<string, unknown>;
  readonly limit: number;
  readonly skip: number;
}

/** MongoDB's `find`: the everyday query. */
export class FindDocumentsTool extends DocumentTool<FindDocumentsArgs> {
  public readonly name = "find_documents";
  public readonly description =
    "Find documents in a MongoDB collection with a filter, optional projection and sort";

  private static readonly MAX_LIMIT = 100;

  public readonly annotations: ToolHints = {
    title: "Find Documents",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    collection: DocumentTool.collectionParam,
    filter: DocumentTool.filterParam,
    projection: z.record(z.unknown()).optional().describe('Fields to include or exclude, e.g. {"name": 1, "_id": 0}'),
    sort: z.record(z.unknown()).optional().describe('Sort order, e.g. {"createdAt": -1}'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(FindDocumentsTool.MAX_LIMIT)
      .default(20)
      .describe("Maximum documents to return (1-100, default 20)"),
    skip: z.number().int().min(0).default(0).describe("Documents to skip, for paging"),
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

  protected async read(args: FindDocumentsArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.checkInputs(target, args.collection, {
      filter: args.filter,
      projection: args.projection,
      sort: args.sort,
    });
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquireDocument(target, this.name);
    const documents = await driver.find(args.collection, {
      filter: args.filter,
      projection: args.projection,
      sort: args.sort,
      limit: Math.min(args.limit, FindDocumentsTool.MAX_LIMIT),
      skip: args.skip,
    });

    return ToolResponse.text(this.rows.format(documents, "Narrow the filter or lower the limit"));
  }
}
