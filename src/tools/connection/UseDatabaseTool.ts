import { z } from "zod";
import type { ZodRawShape } from "zod";
import { BaseTool, type ToolHints } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { ToolResult } from "../../types/tool.types.js";

interface UseDatabaseArgs {
  readonly database: string;
}

/**
 * Switches database on the current server.
 *
 * The verify-then-commit ordering lives in ConnectionManager, so this tool
 * cannot get it wrong: a nonexistent database fails the call and leaves the
 * previous connection working.
 */
export class UseDatabaseTool extends BaseTool<UseDatabaseArgs> {
  public readonly name = "use_database";
  public readonly description =
    "Switch the active database on the current server. Takes effect immediately, no restart needed";

  public readonly inputSchema: ZodRawShape = {
    database: z.string().describe("Database name to switch to, or the database number on Redis"),
  };

  /**
   * Changes which database the reading tools see, so not read-only. Nothing
   * in the database is touched, and switching twice to the same name leaves
   * the same state, hence not destructive and idempotent.
   */
  public readonly annotations: ToolHints = {
    title: "Switch Database",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  constructor(
    private readonly connections: ConnectionManager,
    private readonly names: NamePolicyRegistry
  ) {
    super();
  }

  protected async execute(args: UseDatabaseArgs): Promise<ToolResult> {
    const active = this.connections.requireActiveTarget();
    const check = this.names.for(active.engine).validateDatabase(args.database);
    if (!check.valid) {
      return ToolResponse.failure(check.error ?? "Invalid database name.");
    }

    const target = await this.connections.useDatabase(args.database);
    return ToolResponse.text(`Switched to ${target.describe()}`);
  }
}
