import type { ZodRawShape } from "zod";
import { BaseTool, type ToolHints } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import type { ToolResult } from "../../types/tool.types.js";

/** Reports the active connection, its engine and its database. */
export class CurrentConnectionTool extends BaseTool {
  public readonly name = "current_connection";
  public readonly description =
    "Show which database server, engine and database the read-only tools are currently pointed at";

  public readonly annotations: ToolHints = {
    title: "Show Current Connection",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {};

  /**
   * @param viewerStatus the live log viewer's state, when it is configured,
   *   so "where are my logs?" has an answer in the chat itself.
   */
  constructor(
    private readonly connections: ConnectionManager,
    private readonly viewerStatus: () => string | null = () => null
  ) {
    super();
  }

  protected async execute(): Promise<ToolResult> {
    const target = this.connections.getActiveTarget();

    // Reads the nullable accessor rather than the asserting one, so an
    // unconfigured server reports its state as ordinary output instead of an
    // error. Nothing has gone wrong; nothing has been chosen yet.
    const viewer = this.viewerStatus();
    const viewerLine = viewer ? [`Live log viewer: ${viewer}`] : [];

    if (!target) {
      return ToolResponse.text(
        ["No active connection. Call connect or use_connection to set one.", ...viewerLine].join("\n")
      );
    }

    // Rendering through describe() is what keeps the password out of output.
    return ToolResponse.text(
      [
        `Active profile: ${this.connections.getActiveName()}`,
        `Engine: ${EngineCatalog.label(target.engine)}`,
        `Target: ${target.describe()}`,
        ...viewerLine,
      ].join("\n")
    );
  }
}
