import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import { SearchBodyValidator } from "../../validation/search/SearchBodyValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface SearchArgs extends DatabaseScopedArgs {
  readonly index: string;
  readonly body: Record<string, unknown>;
}

/**
 * An Elasticsearch or OpenSearch `_search`, with the body in Query DSL.
 *
 * One tool rather than separate search and count tools: `size: 0` with
 * `track_total_hits: true` is a count, and aggregations ride in the same
 * body, so a second tool would only duplicate this one's argument.
 */
export class SearchTool extends DatabaseScopedTool<SearchArgs> {
  public readonly name = "search";
  public readonly description =
    "Search an Elasticsearch or OpenSearch index with a Query DSL body. Use size 0 with track_total_hits true to count, and aggs for aggregations";

  protected override readonly family = "search" as const;

  private static readonly MAX_SIZE = 100;
  private static readonly DEFAULT_SIZE = 10;

  public readonly annotations: ToolHints = {
    title: "Search Index",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    index: z.string().describe("Index name, pattern such as logs-*, or comma-separated list"),
    body: z
      .record(z.unknown())
      .default({})
      .describe('Search body, e.g. {"query": {"match": {"title": "error"}}, "size": 10, "sort": [{"@timestamp": "desc"}]}'),
  };

  constructor(
    drivers: DriverProvider,
    names: NamePolicyRegistry,
    private readonly bodies: SearchBodyValidator
  ) {
    super(drivers, names);
  }

  protected async read(args: SearchArgs, target: ConnectionTarget): Promise<ToolResult> {
    const rejection =
      this.validateObjectName(target, args.index, "index name") ?? this.reject(this.bodies.validate(args.body));
    if (rejection) {
      return rejection;
    }

    const driver = await this.drivers.acquireSearch(target, this.name);
    return ToolResponse.json(await driver.search(args.index, { ...args.body, size: this.size(args.body.size) }));
  }

  /**
   * Capped rather than rejected when too large: the caller wanted results,
   * and a hundred of them answers the question better than an error does.
   */
  private size(requested: unknown): number {
    if (typeof requested !== "number" || !Number.isFinite(requested)) {
      return SearchTool.DEFAULT_SIZE;
    }
    return Math.min(Math.max(Math.trunc(requested), 0), SearchTool.MAX_SIZE);
  }
}
