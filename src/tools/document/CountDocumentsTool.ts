import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { DocumentTool, type DocumentArgs } from "./DocumentTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { MongoOperatorGuard } from "../../validation/document/MongoOperatorGuard.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { ToolResult } from "../../types/tool.types.js";

interface CountDocumentsArgs extends DocumentArgs {
  readonly filter: Record<string, unknown>;
}

/** An exact count of matching documents. */
export class CountDocumentsTool extends DocumentTool<CountDocumentsArgs> {
  public readonly name = "count_documents";
  public readonly description = "Count documents in a MongoDB collection that match a filter";

  public readonly annotations: ToolHints = {
    title: "Count Documents",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    collection: DocumentTool.collectionParam,
    filter: DocumentTool.filterParam,
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(drivers: DriverProvider, names: NamePolicyRegistry, guard: MongoOperatorGuard) {
    super(drivers, names, guard);
  }

  protected async read(args: CountDocumentsArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection = this.checkInputs(target, args.collection, { filter: args.filter });
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquireDocument(target, this.name);
    const count = await driver.count(args.collection, args.filter);
    return ToolResponse.text(`${count} matching document${count === 1 ? "" : "s"} in "${args.collection}".`);
  }
}
