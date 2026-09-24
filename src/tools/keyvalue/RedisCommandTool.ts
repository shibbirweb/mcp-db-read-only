import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import { RedisCommandValidator } from "../../validation/keyvalue/RedisCommandValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface RedisCommandArgs extends DatabaseScopedArgs {
  readonly command: string;
  readonly args: string[];
}

/**
 * One read-only Redis command: Redis's equivalent of run_query.
 *
 * The command name and its arguments are separate fields rather than one
 * string, so an argument containing a space or a quote is never re-split,
 * and there is no command-line syntax to get wrong.
 */
export class RedisCommandTool extends DatabaseScopedTool<RedisCommandArgs> {
  public readonly name = "redis_command";
  public readonly description =
    "Run one read-only Redis command such as GET, HGETALL, LRANGE, ZRANGE, SCAN, TTL or INFO. Write commands and KEYS are refused";

  protected override readonly family = "keyvalue" as const;

  public readonly annotations: ToolHints = {
    title: "Run Read-Only Redis Command",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    command: z.string().describe("Command name, e.g. HGETALL"),
    args: z.array(z.string()).default([]).describe('Arguments, e.g. ["user:42"]'),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    drivers: DriverProvider,
    names: NamePolicyRegistry,
    private readonly validator: RedisCommandValidator
  ) {
    super(drivers, names);
  }

  protected async read(args: RedisCommandArgs, target: ConnectionTarget): Promise<ToolResult> {
    const check = this.validator.validate(args.command, args.args);
    if (!check.valid || !check.name) {
      return ToolResponse.failure(check.error ?? "Command rejected.");
    }

    const driver = await this.drivers.acquireKeyValue(target, this.name);
    return ToolResponse.json(await driver.command(check.name, args.args));
  }
}
