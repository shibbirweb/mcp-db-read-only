import { z } from "zod";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import { MongoOperatorGuard } from "../../validation/document/MongoOperatorGuard.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

/** Arguments every MongoDB query tool shares. */
export interface DocumentArgs extends DatabaseScopedArgs {
  readonly collection: string;
}

/**
 * Base for the MongoDB query tools.
 *
 * Holds what all four share: the collection argument, the family check, and
 * the operator guard every filter and pipeline passes through before the
 * driver sees it.
 */
export abstract class DocumentTool<TArgs extends DocumentArgs> extends DatabaseScopedTool<TArgs> {
  protected override readonly family = "document" as const;

  protected static readonly collectionParam = z.string().describe("Collection name");

  protected static readonly filterParam = z
    .record(z.unknown())
    .default({})
    .describe('Query filter as MongoDB Extended JSON, e.g. {"status": "active", "_id": {"$oid": "..."}}');

  constructor(
    drivers: DriverProvider,
    names: NamePolicyRegistry,
    protected readonly guard: MongoOperatorGuard
  ) {
    super(drivers, names);
  }

  /** The collection name and every filter or pipeline, checked in one place. */
  protected checkInputs(
    target: ConnectionTarget,
    collection: string,
    inputs: Record<string, unknown>
  ): ToolResult | null {
    const rejection = this.validateObjectName(target, collection, "collection name");
    if (rejection) {
      return rejection;
    }
    for (const [label, value] of Object.entries(inputs)) {
      if (value !== undefined) {
        const objection = this.reject(this.guard.validate(value, label));
        if (objection) {
          return objection;
        }
      }
    }
    return null;
  }
}
