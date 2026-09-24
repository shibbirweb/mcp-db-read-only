import type { Pool } from "mysql2/promise";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { SqlDriver } from "../DatabaseDriver.js";
import { GlobPattern } from "../GlobPattern.js";
import { LazyResource } from "../LazyResource.js";
import { MySqlSessionInitializer } from "./MySqlSessionInitializer.js";
import { SqlIdentifier } from "./SqlIdentifier.js";

/**
 * MySQL and MariaDB, through mysql2.
 *
 * Read-only layer two: every pooled connection is opened with
 * `SET SESSION TRANSACTION READ ONLY` (see MySqlSessionInitializer), and
 * multipleStatements is off, so the protocol cannot carry a second statement.
 */
export class MySqlDriver extends BaseDriver implements SqlDriver {
  public readonly family = "sql";
  public readonly dialect = "mysql";

  /**
   * Hidden by default: noise in almost every session. `include_system` on
   * list_databases exists because inspecting them is occasionally the task.
   */
  private static readonly SYSTEM_SCHEMAS = new Set([
    "information_schema",
    "performance_schema",
    "mysql",
    "sys",
  ]);

  private static readonly FOREIGN_KEYS = `SELECT COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`;

  private static readonly NO_SUCH_TABLE = 1146;

  private readonly pool: LazyResource<Pool>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning,
    private readonly logger: (message: string) => void
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

  public async listDatabases(): Promise<DatabaseEntry[]> {
    const rows = (await this.run("SHOW DATABASES")) as Record<string, string>[];
    return rows.map((row) => {
      const name = Object.values(row)[0];
      return { name, system: MySqlDriver.SYSTEM_SCHEMAS.has(name) };
    });
  }

  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    this.requireDatabase();
    const rows = (await this.run("SHOW TABLES")) as Record<string, string>[];
    // SHOW TABLES returns single-key objects whose key name varies with the
    // database (Tables_in_<name>). A plain list is far easier to read.
    return new GlobPattern(pattern).apply(
      rows.map((row) => Object.values(row)[0]),
      limit
    );
  }

  public async describeObject(name: string): Promise<unknown> {
    return this.onTable(name, () => this.run(`SHOW COLUMNS FROM ${this.quote(name)}`));
  }

  public async listIndexes(name: string): Promise<unknown> {
    return this.onTable(name, () => this.run(`SHOW INDEX FROM ${this.quote(name)}`));
  }

  /** The foreign-key query answers a missing table with no rows, which reads as "no keys", so existence is checked first. */
  public async listForeignKeys(name: string): Promise<unknown[]> {
    const qualified = SqlIdentifier.parse(name);
    await this.onTable(name, () => this.run(`SELECT 1 FROM ${this.quote(name)} LIMIT 0`));
    return this.run(MySqlDriver.FOREIGN_KEYS, [qualified.schema, qualified.name]);
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    return this.onTable(name, () => this.run(`SELECT * FROM ${this.quote(name)} LIMIT ${limit}`));
  }

  public query(sql: string): Promise<unknown[]> {
    return this.run(sql);
  }

  /** Placeholders for values wherever the statement allows; identifiers are quoted. */
  private async run(sql: string, params?: unknown[]): Promise<unknown[]> {
    const pool = await this.pool.get();
    const [rows] = await pool.query(sql, params);
    return rows as unknown[];
  }

  /**
   * Runs work against one table, turning MySQL's "table doesn't exist" (error
   * 1146) into the same ObjectNotFoundError every other engine raises, so a
   * missing table reads the same whichever engine is behind the connection.
   */
  private async onTable<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if ((error as { errno?: number }).errno === MySqlDriver.NO_SUCH_TABLE) {
        throw new ObjectNotFoundError(this.objectNoun, name);
      }
      throw error;
    }
  }

  private quote(name: string): string {
    return SqlIdentifier.quoteQualified(SqlIdentifier.parse(name), SqlIdentifier.backtick);
  }

  /**
   * Imported on first use rather than at startup. Eight drivers loaded eagerly
   * would put every one of them on the startup path of a server that will,
   * in most sessions, only ever talk to one engine.
   */
  private async createPool(): Promise<Pool> {
    const { default: mysql } = await import("mysql2/promise");

    const pool = mysql.createPool({
      host: this.target.host,
      port: this.target.port,
      user: this.target.user,
      password: this.target.password,
      database: this.target.database || undefined,
      connectionLimit: this.tuning.connectionLimit,
      waitForConnections: true,

      // The single most important option here. With multiple statements
      // enabled, the read-only guarantee would rest entirely on the validator
      // finding every separator. Disabled, the protocol cannot carry a second
      // statement at all, so a validator bug is not a dropped table.
      multipleStatements: false,

      connectTimeout: this.tuning.connectTimeoutMs,

      // Without this, mysql2 returns Date objects that JSON.stringify converts
      // to UTC ISO strings, silently shifting every timestamp by the server's
      // offset. Strings come back exactly as the server stored them.
      dateStrings: true,

      ssl: this.sslOptions(),
    });

    new MySqlSessionInitializer(this.tuning.queryTimeoutMs, this.logger).attachTo(pool);
    return pool;
  }

  /** `?ssl=true` requires TLS; `?ssl-mode=REQUIRED` is accepted as the MySQL spelling. */
  private sslOptions(): { rejectUnauthorized: boolean } | undefined {
    const mode = (this.target.option("ssl-mode") ?? this.target.option("sslmode") ?? "").toUpperCase();
    if (this.target.flag("ssl") || ["REQUIRED", "REQUIRE"].includes(mode)) {
      return { rejectUnauthorized: false };
    }
    if (["VERIFY_CA", "VERIFY_IDENTITY", "VERIFY-CA", "VERIFY-FULL"].includes(mode)) {
      return { rejectUnauthorized: true };
    }
    return undefined;
  }
}
