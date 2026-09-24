import { z } from "zod";
import type { ZodRawShape } from "zod";
import { BaseTool, type ToolHints } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { ToolResult } from "../../types/tool.types.js";

interface UseConnectionArgs {
  readonly profile: string;
  readonly database?: string;
}

/**
 * Switches to a named profile, optionally overriding its database.
 *
 * The override composes two ideas that would otherwise take two calls: "go to
 * staging, but the analytics database".
 */
export class UseConnectionTool extends BaseTool<UseConnectionArgs> {
  public readonly name = "use_connection";
  public readonly description =
    "Switch to a named connection profile, on any engine. Takes effect immediately, no restart needed";

  public readonly inputSchema: ZodRawShape = {
    profile: z.string().describe("Profile name from list_connections"),
    database: z
      .string()
      .optional()
      .describe("Optional database to use instead of the profile's own database"),
  };

  /**
   * Repoints the reading tools at another server, so not read-only. No data is
   * altered and repeating the call is a no-op, hence not destructive and
   * idempotent.
   */
  public readonly annotations: ToolHints = {
    title: "Switch Connection Profile",
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

  protected async execute(args: UseConnectionArgs): Promise<ToolResult> {
    // The override is checked against the profile's own engine, which may not
    // be the active one: switching from MySQL to a Redis profile with
    // database "3" is valid, and MySQL's rules would refuse nothing useful.
    const profile = this.connections.findProfile(args.profile);
    if (args.database && profile) {
      const check = this.names.for(profile.target.engine).validateDatabase(args.database);
      if (!check.valid) {
        return ToolResponse.failure(check.error ?? "Invalid database name.");
      }
    }

    // An unknown profile throws UnknownProfileError, which carries the known
    // names; BaseTool turns it into a tool error. When someone mistypes a
    // profile, seeing the real list is the fastest route to the fix.
    const target = await this.connections.useProfile(args.profile, args.database);

    return ToolResponse.text(
      `Switched to profile "${args.profile}" (${EngineCatalog.label(target.engine)}) -> ${target.describe()}`
    );
  }
}
