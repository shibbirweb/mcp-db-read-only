import type { Pool, PoolClient, QueryConfig } from "pg";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { SqlDriver } from "../DatabaseDriver.js";
import { GlobPattern } from "../GlobPattern.js";
import { LazyResource } from "../LazyResource.js";
import { SqlIdentifier } from "./SqlIdentifier.js";

/**
 * pg's runtime accepts `queryMode`, but its type definitions predate it.
 * Declared here rather than cast at the call site, so the one place relying on
 * it says so.
 */
type ExtendedQueryConfig = QueryConfig & { queryMode: "extended" };

/**
 * PostgreSQL, and anything wire-compatible with it, through node-postgres.
 *
 * Read-only layer two: **every statement runs inside a transaction opened
 * READ ONLY, and that transaction is always rolled back.** PostgreSQL refuses
 * any write inside it, and whatever a statement manages to change without
 * writing (a `set_config` smuggled through a function, say) is undone by the
 * rollback before the connection returns to the pool.
 *
 * This is done per transaction rather than with connection startup options
 * such as `-c default_transaction_read_only=on`, because PgBouncer and most
 * managed poolers reject startup options, and a read-only guarantee that only
 * works without a pooler is not one.
 *
 * The statement itself goes over the extended query protocol, which carries
 * exactly one statement, so a second one cannot be stacked behind it whatever
 * the validator concluded.
 */
export class PostgresDriver extends BaseDriver implements SqlDriver {
  public readonly family = "sql";
  public readonly dialect = "postgres";

  /**
   * Date and time types come back as the text PostgreSQL sent. Parsed into
   * Date objects they would be re-serialised as UTC ISO strings, silently
   * shifting every value without a time zone by the host's offset.
   */
  private static readonly RAW_TEXT_TYPES = new Set([1082, 1083, 1114, 1184, 1266]);

  private readonly pool: LazyResource<Pool>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning
  ) {
    super(target);
    this.pool = new LazyResource(
      () => this.createPool(),
      (pool) => pool.end()
    );
  }

  public async verify(): Promise<void> {
    await this.run("SELECT 1");
  }

  public close(): Promise<void> {
    return this.pool.close();
  }

  /** Templates are system databases; connections are refused to some, so those are left out. */
  public async listDatabases(): Promise<DatabaseEntry[]> {
    const rows = (await this.run(
      "SELECT datname AS name, datistemplate AS system FROM pg_database WHERE datallowconn ORDER BY datname"
    )) as { name: string; system: boolean }[];
    return rows.map((row) => ({ name: row.name, system: row.system }));
  }

  /**
   * Tables in `public` are listed bare and everything else schema-qualified,
   * which is how they are then written in a query.
   */
  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const rows = (await this.run(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%'
       ORDER BY table_schema, table_name`
    )) as { table_schema: string; table_name: string }[];

    const names = rows.map((row) =>
      row.table_schema === "public" ? row.table_name : `${row.table_schema}.${row.table_name}`
    );
    return new GlobPattern(pattern).apply(names, limit);
  }

  public async describeObject(name: string): Promise<unknown> {
    const qualified = SqlIdentifier.parse(name);
    const rows = await this.run(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = COALESCE($1::text, current_schema()) AND table_name = $2
       ORDER BY ordinal_position`,
      [qualified.schema, qualified.name]
    );
    if (rows.length === 0) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
    return rows;
  }

  public async listIndexes(name: string): Promise<unknown> {
    const qualified = SqlIdentifier.parse(name);
    await this.assertExists(name);
    return this.run(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = COALESCE($1::text, current_schema()) AND tablename = $2
       ORDER BY indexname`,
      [qualified.schema, qualified.name]
    );
  }

  public async listForeignKeys(name: string): Promise<unknown[]> {
    const qualified = SqlIdentifier.parse(name);
    await this.assertExists(name);
    return this.run(
      `SELECT c.conname AS constraint_name, pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype = 'f' AND n.nspname = COALESCE($1::text, current_schema()) AND t.relname = $2
       ORDER BY c.conname`,
      [qualified.schema, qualified.name]
    );
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    const table = SqlIdentifier.quoteQualified(SqlIdentifier.parse(name), SqlIdentifier.doubleQuote);
    return this.run(`SELECT * FROM ${table} LIMIT $1`, [limit]);
  }

  public query(sql: string): Promise<unknown[]> {
    return this.run(sql);
  }

  /**
   * One statement inside a read-only transaction that is always rolled back.
   *
   * The opening batch is a single round trip. standard_conforming_strings is
   * pinned on because the SQL validator lexes plain strings without backslash
   * escapes, and that is only how PostgreSQL reads them while it is on.
   */
  private async run(text: string, values?: unknown[]): Promise<unknown[]> {
    const pool = await this.pool.get();
    const client = await pool.connect();
    let broken: Error | undefined;

    try {
      await client.query(
        `BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = ${this.tuning.queryTimeoutMs}; SET LOCAL standard_conforming_strings = on`
      );
      const config: ExtendedQueryConfig = { text, values, queryMode: "extended" };
      const result = await client.query(config);
      return result.rows as unknown[];
    } finally {
      broken = await this.rollback(client);
      // A connection whose rollback failed is in an unknown state, so it is
      // destroyed rather than handed to the next query.
      client.release(broken);
    }
  }

  private async rollback(client: PoolClient): Promise<Error | undefined> {
    try {
      await client.query("ROLLBACK");
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  private async assertExists(name: string): Promise<void> {
    const qualified = SqlIdentifier.parse(name);
    const rows = await this.run(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = COALESCE($1::text, current_schema()) AND table_name = $2`,
      [qualified.schema, qualified.name]
    );
    if (rows.length === 0) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
  }

  /** Imported on first use; see MySqlDriver.createPool. */
  private async createPool(): Promise<Pool> {
    const { default: pg } = await import("pg");

    const pool = new pg.Pool({
      host: this.target.host,
      port: this.target.port,
      user: this.target.user || undefined,
      password: this.target.password || undefined,
      database: this.target.database || undefined,
      max: this.tuning.connectionLimit,
      connectionTimeoutMillis: this.tuning.connectTimeoutMs,
      application_name: "mcp-db-read-only",
      ssl: this.sslOptions(),
      types: {
        getTypeParser: ((oid: number, format?: "text" | "binary") =>
          PostgresDriver.RAW_TEXT_TYPES.has(oid)
            ? (value: string) => value
            : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
      },
    });

    // An idle client that loses its connection emits on the pool; without a
    // listener that is an unhandled error and the whole process exits.
    pool.on("error", () => undefined);
    return pool;
  }

  /**
   * libpq's sslmode names. `require` encrypts without checking the
   * certificate, as libpq does; the verify modes check it.
   */
  private sslOptions(): false | { rejectUnauthorized: boolean } {
    const mode = (this.target.option("sslmode") ?? "").toLowerCase();
    if (mode === "verify-ca" || mode === "verify-full") {
      return { rejectUnauthorized: true };
    }
    if (mode === "require" || this.target.flag("ssl")) {
      return { rejectUnauthorized: false };
    }
    return false;
  }
}
