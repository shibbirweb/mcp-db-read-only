import type { ConnectionPool } from "mssql";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { StatementTracer } from "../../logging/StatementTracer.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { SqlDriver } from "../DatabaseDriver.js";
import { GlobPattern } from "../GlobPattern.js";
import { LazyResource } from "../LazyResource.js";
import { SqlIdentifier } from "./SqlIdentifier.js";

type MsSqlModule = typeof import("mssql");

/**
 * SQL Server and Azure SQL, through the `mssql` package (tedious underneath).
 *
 * Read-only layer two: SQL Server has no read-only session mode, so **every
 * batch runs inside a transaction that is always rolled back**. A write that
 * got past the validator is undone before the connection is reused, and
 * statements that refuse to run inside a transaction (BACKUP, ALTER DATABASE)
 * fail outright. The validator separately refuses COMMIT, so the batch cannot
 * end the transaction early.
 *
 * `?applicationIntent=ReadOnly` routes to a readable secondary in an
 * availability group. It is opt-in: against a primary that disallows
 * read-intent connections, forcing it would make every connection fail.
 */
export class MsSqlDriver extends BaseDriver implements SqlDriver {
  public readonly family = "sql";
  public readonly dialect = "mssql";

  private static readonly SYSTEM_DATABASES = new Set(["master", "tempdb", "model", "msdb"]);

  private readonly pool: LazyResource<{ pool: ConnectionPool; sql: MsSqlModule }>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning,
    tracer: StatementTracer
  ) {
    super(target, tracer);
    this.pool = new LazyResource(
      () => this.createPool(),
      (opened) => opened.pool.close()
    );
  }

  public async verify(): Promise<void> {
    await this.run("SELECT 1 AS ok");
  }

  public close(): Promise<void> {
    return this.pool.close();
  }

  public async listDatabases(): Promise<DatabaseEntry[]> {
    const rows = (await this.run("SELECT name FROM sys.databases WHERE state = 0 ORDER BY name")) as {
      name: string;
    }[];
    return rows.map((row) => ({ name: row.name, system: MsSqlDriver.SYSTEM_DATABASES.has(row.name) }));
  }

  /** `dbo` tables are listed bare and everything else schema-qualified. */
  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const rows = (await this.run(
      "SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME"
    )) as { table_schema: string; table_name: string }[];
    const names = rows.map((row) =>
      row.table_schema === "dbo" ? row.table_name : `${row.table_schema}.${row.table_name}`
    );
    return new GlobPattern(pattern).apply(names, limit);
  }

  public async describeObject(name: string): Promise<unknown> {
    const qualified = SqlIdentifier.parse(name);
    const rows = await this.run(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = COALESCE(@schema, SCHEMA_NAME()) AND TABLE_NAME = @table
       ORDER BY ORDINAL_POSITION`,
      { schema: qualified.schema, table: qualified.name }
    );
    if (rows.length === 0) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
    return rows;
  }

  public async listIndexes(name: string): Promise<unknown> {
    await this.assertExists(name);
    return this.run(
      `SELECT i.name AS index_name, i.type_desc, i.is_unique, i.is_primary_key, c.name AS column_name,
              ic.key_ordinal, ic.is_included_column
       FROM sys.indexes i
       JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
       JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
       WHERE i.object_id = OBJECT_ID(@object)
       ORDER BY i.name, ic.key_ordinal`,
      { object: this.quote(name) }
    );
  }

  public async listForeignKeys(name: string): Promise<unknown[]> {
    await this.assertExists(name);
    return this.run(
      `SELECT fk.name AS constraint_name, pc.name AS column_name,
              OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS referenced_schema,
              OBJECT_NAME(fk.referenced_object_id) AS referenced_table,
              rc.name AS referenced_column
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE fk.parent_object_id = OBJECT_ID(@object)
       ORDER BY fk.name`,
      { object: this.quote(name) }
    );
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    return this.run(`SELECT TOP (@limit) * FROM ${this.quote(name)}`, { limit });
  }

  public query(sql: string): Promise<unknown[]> {
    return this.run(sql);
  }

  /**
   * One batch inside a transaction that is always rolled back.
   *
   * If the batch itself fails, SQL Server may already have aborted the
   * transaction, and the rollback then fails too. That second failure is
   * swallowed: the batch's own error is the one worth reporting, and an
   * aborted transaction has nothing left to undo.
   */
  private async run(text: string, inputs: Record<string, unknown> = {}): Promise<unknown[]> {
    const { pool, sql } = await this.pool.get();
    const transaction = new sql.Transaction(pool);
    await this.traced("BEGIN TRANSACTION", undefined, () => transaction.begin(), () => "ok");

    try {
      const request = new sql.Request(transaction);
      for (const [name, value] of Object.entries(inputs)) {
        request.input(name, value);
      }
      const params = Object.keys(inputs).length > 0 ? inputs : undefined;
      return await this.traced(text, params, async () => ((await request.query(text)).recordset ?? []) as unknown[]);
    } finally {
      await this.traced("ROLLBACK", undefined, () => transaction.rollback(), () => "ok").catch(() => undefined);
    }
  }

  private async assertExists(name: string): Promise<void> {
    const rows = await this.run("SELECT OBJECT_ID(@object) AS id", { object: this.quote(name) });
    if ((rows[0] as { id: number | null } | undefined)?.id == null) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
  }

  private quote(name: string): string {
    return SqlIdentifier.quoteQualified(SqlIdentifier.parse(name), SqlIdentifier.bracket);
  }

  /** Imported on first use; see MySqlDriver.createPool. */
  private async createPool(): Promise<{ pool: ConnectionPool; sql: MsSqlModule }> {
    const { default: sql } = (await import("mssql")) as unknown as { default: MsSqlModule };

    const pool = new sql.ConnectionPool({
      server: this.target.host,
      port: this.target.port,
      user: this.target.user,
      password: this.target.password,
      database: this.target.database || undefined,
      connectionTimeout: this.tuning.connectTimeoutMs,
      requestTimeout: this.tuning.queryTimeoutMs,
      pool: { max: this.tuning.connectionLimit, min: 0 },
      options: {
        // Encrypted unless the URL says otherwise, which is also tedious's
        // default. A self-signed development server needs
        // trustServerCertificate=true.
        encrypt: this.target.flag("encrypt") ?? true,
        trustServerCertificate: this.target.flag("trustServerCertificate") ?? false,
        readOnlyIntent: (this.target.option("applicationIntent") ?? "").toLowerCase() === "readonly",
        appName: "mcp-db-read-only",
      },
    });

    // Without a listener a dropped idle connection is an unhandled error.
    pool.on("error", () => undefined);
    await pool.connect();
    return { pool, sql };
  }
}
