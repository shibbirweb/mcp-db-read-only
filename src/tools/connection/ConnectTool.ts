import { z } from "zod";
import type { ZodRawShape } from "zod";
import { BaseTool, type ToolHints } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ConnectionTargetFactory } from "../../connections/ConnectionTargetFactory.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { NamePolicyRegistry } from "../../validation/names/NamePolicyRegistry.js";
import type { ToolResult } from "../../types/tool.types.js";

interface ConnectArgs {
  readonly url: string;
  readonly password?: string;
  readonly alias?: string;
}

/**
 * Opens an arbitrary server, on any engine, at runtime.
 *
 * This is the tool that makes a restart unnecessary in every case.
 * DB_PROFILES is a convenience; this is the guarantee.
 */
export class ConnectTool extends BaseTool<ConnectArgs> {
  public readonly name = "connect";
  public readonly description =
    "Connect to a database at runtime with a connection URL (mysql, mariadb, postgres, sqlite, mssql, clickhouse, mongodb, redis, elasticsearch, opensearch). Not persisted to disk, but kept for the rest of the session under an alias";

  /**
   * Not read-only: it opens a server and stores the alias for the session.
   * Not destructive either, because nothing in any database changes, and
   * re-running the same call lands on the same connection.
   */
  public readonly annotations: ToolHints = {
    title: "Connect to Database",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  /** Used when no alias is given, so repeated ad-hoc connections overwrite. */
  private static readonly DEFAULT_ALIAS = "custom";

  public readonly inputSchema: ZodRawShape = {
    url: z
      .string()
      // The two most common setup mistakes, spelled out because a model
      // reading this description usually gets them right unprompted:
      // localhost inside a container, and a SQLite path without three slashes.
      .describe(
        "Connection URL, e.g. postgres://user@host:5432/db, mongodb://user@host/db, redis://host:6379/0, sqlite:///path/to/file.db. Use host.docker.internal for a database on this machine when running in Docker"
      ),
    password: z
      .string()
      .optional()
      .describe("Password, if not in the URL. Avoids percent-encoding special characters"),
    alias: z
      .string()
      .optional()
      .describe("Name to remember this connection under for use_connection later"),
  };

  constructor(
    private readonly connections: ConnectionManager,
    private readonly targetFactory: ConnectionTargetFactory,
    private readonly names: NamePolicyRegistry
  ) {
    super();
  }

  protected async execute(args: ConnectArgs): Promise<ToolResult> {
    const target = this.targetFactory.fromUrl(args.url, args.password);

    // A SQLite target's database is its file path, which no name policy
    // describes; everything else is checked like any other database name.
    if (target.database && EngineCatalog.describe(target.engine).switchesDatabases) {
      const check = this.names.for(target.engine).validateDatabase(target.database);
      if (!check.valid) {
        return ToolResponse.failure(check.error ?? "Invalid database name.");
      }
    }

    const alias = args.alias ?? ConnectTool.DEFAULT_ALIAS;
    await this.connections.connect(target, alias);

    return ToolResponse.text(
      `Connected as "${alias}" (${EngineCatalog.label(target.engine)}) -> ${target.describe()}`
    );
  }
}
