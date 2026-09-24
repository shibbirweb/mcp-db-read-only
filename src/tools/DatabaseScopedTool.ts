import { z } from "zod";
import { BaseTool } from "./BaseTool.js";
import type { ConnectionTarget } from "../domain/ConnectionTarget.js";
import type { EngineFamily } from "../domain/Engine.js";
import { DriverProvider } from "../drivers/DriverProvider.js";
import { ToolResponse } from "../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../validation/names/NamePolicyRegistry.js";
import type { DatabaseScopedArgs, ToolResult } from "../types/tool.types.js";
import type { ValidationResult } from "../types/validation.types.js";

/**
 * Base for every tool that reads through the active connection.
 *
 * Refines the Template Method one step further: `execute` is implemented here
 * to resolve the connection, check the tool fits its engine, and validate the
 * shared `database` argument, and subclasses supply `read`. Without this,
 * every tool would repeat the same three guards, and a new tool could
 * silently omit one and interpolate an unchecked name.
 *
 * The per-call `database` override exists for two reasons: comparing two
 * databases otherwise means switching, reading and switching back, and a call
 * carrying its own database does not depend on shared mutable state, so it
 * cannot be reordered against a switch issued in the same batch.
 */
export abstract class DatabaseScopedTool<
  TArgs extends DatabaseScopedArgs = DatabaseScopedArgs,
> extends BaseTool<TArgs> {
  /** Reused by every subclass so the argument reads identically everywhere. */
  protected static readonly databaseParam = z
    .string()
    .optional()
    .describe(
      "Optional database to read from for this call only, without changing the active connection"
    );

  /**
   * The engine family this tool speaks, or null for the browse tools that
   * work on every engine. Checked before anything else, so run_query against
   * MongoDB fails with a pointer to the right tool rather than a parse error.
   */
  protected readonly family: EngineFamily | null = null;

  constructor(
    protected readonly drivers: DriverProvider,
    protected readonly names: NamePolicyRegistry
  ) {
    super();
  }

  protected abstract read(args: TArgs, target: ConnectionTarget): Promise<ToolResult>;

  protected async execute(args: TArgs): Promise<ToolResult> {
    const active = this.drivers.requireActiveTarget();

    if (this.family) {
      this.drivers.requireFamily(active, this.family, this.name);
    }

    if (args.database) {
      const rejection = this.reject(this.names.for(active.engine).validateDatabase(args.database));
      if (rejection) {
        return rejection;
      }
    }

    return this.read(args, this.drivers.resolveTarget(args.database));
  }

  /**
   * @returns a failure result, or null when the name is valid. Returning a
   *   value rather than throwing keeps "the caller passed something invalid"
   *   distinct from "something failed at runtime".
   */
  protected validateObjectName(target: ConnectionTarget, value: string, label: string): ToolResult | null {
    return this.reject(this.names.for(target.engine).validateObject(value, label));
  }

  protected reject(result: ValidationResult): ToolResult | null {
    return result.valid ? null : ToolResponse.failure(result.error ?? "Invalid argument.");
  }
}
