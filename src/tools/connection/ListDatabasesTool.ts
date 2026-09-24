import { z } from "zod";
import type { ZodRawShape } from "zod";
import { BaseTool, type ToolHints } from "../BaseTool.js";
import { DriverProvider } from "../../drivers/DriverProvider.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import type { ToolResult } from "../../types/tool.types.js";

interface ListDatabasesArgs {
  readonly include_system: boolean;
}

/** Lists databases on the connected server, marking the active one. */
export class ListDatabasesTool extends BaseTool<ListDatabasesArgs> {
  public readonly name = "list_databases";
  public readonly description =
    "List databases on the currently connected server (schemas on MySQL, numbered databases on Redis)";

  public readonly annotations: ToolHints = {
    title: "List Databases",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  /**
   * System databases are noise in almost every session and make it harder to
   * spot the one you want. `include_system` exists because inspecting them is
   * occasionally the real task.
   */
  public readonly inputSchema: ZodRawShape = {
    include_system: z
      .boolean()
      .default(false)
      .describe("Include system databases such as information_schema, pg templates, or MongoDB admin and local"),
  };

  constructor(private readonly drivers: DriverProvider) {
    super();
  }

  protected async execute(args: ListDatabasesArgs): Promise<ToolResult> {
    const target = this.drivers.requireActiveTarget();
    const driver = await this.drivers.acquire(target);
    const entries = await driver.listDatabases();

    const names = entries
      .filter((entry) => args.include_system || !entry.system)
      .map((entry) => entry.name);

    const lines = names.map((name) => (name === target.database ? `* ${name}` : `  ${name}`));

    return ToolResponse.text(`Databases (${names.length}):\n${lines.join("\n")}`);
  }
}
