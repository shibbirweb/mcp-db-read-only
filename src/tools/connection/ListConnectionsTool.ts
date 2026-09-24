import type { ZodRawShape } from "zod";
import { BaseTool, type ToolHints } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import type { ToolResult } from "../../types/tool.types.js";

/**
 * Lists the profiles available to switch to.
 *
 * Shows each profile's origin and engine: `(env)` versus `(session)` tells the
 * reader whether the connection will still be there after a restart, and the
 * engine says which query tools apply to it.
 */
export class ListConnectionsTool extends BaseTool {
  public readonly name = "list_connections";
  public readonly description =
    "List the connection profiles available to switch to, with each one's engine, including any added during this session";

  public readonly annotations: ToolHints = {
    title: "List Connection Profiles",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {};

  constructor(private readonly connections: ConnectionManager) {
    super();
  }

  protected async execute(): Promise<ToolResult> {
    const profiles = this.connections.listProfiles();

    if (profiles.length === 0) {
      return ToolResponse.text("No profiles configured. Use connect to open one directly.");
    }

    const activeName = this.connections.getActiveName();
    // The profile renders its own line, including the "* " active marker, so
    // the display rule lives with the entity rather than being duplicated by
    // every caller that wants to show a profile.
    const lines = profiles.map((profile) => profile.describe(profile.name === activeName));

    return ToolResponse.text(`Connection profiles:\n${lines.join("\n")}`);
  }
}
