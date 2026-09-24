import type { ClickHouseClient, ClickHouseSettings } from "@clickhouse/client";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { StatementTracer } from "../../logging/StatementTracer.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { SqlDriver } from "../DatabaseDriver.js";
import { GlobPattern } from "../GlobPattern.js";
import { LazyResource } from "../LazyResource.js";
import { SqlIdentifier } from "./SqlIdentifier.js";

interface OpenedClient {
  readonly client: ClickHouseClient;
  readonly settings: ClickHouseSettings;
}

/**
 * ClickHouse, through the official client over the HTTP interface.
 *
 * Read-only layer two is ClickHouse's own `readonly` setting, sent with every
 * query. `readonly=2` refuses every write and DDL statement while still
 * allowing the timeout and result caps below to be set, and it cannot itself
 * be lowered from inside a query.
 *
 * An account that is already read-only on the server (a user profile with
 * `readonly=1`) refuses any setting at all, the read-only one included. So the
 * driver asks first and only sends what the account permits: a server that
 * already enforces read-only needs nothing from us to do so.
 */
export class ClickHouseDriver extends BaseDriver implements SqlDriver {
  public readonly family = "sql";
  public readonly dialect = "clickhouse";

  private static readonly SYSTEM_DATABASES = new Set(["system", "INFORMATION_SCHEMA", "information_schema"]);

  /**
   * An analytics table can hold billions of rows, and the formatter shows only
   * a hundred. Capping on the server stops a careless SELECT * from pulling a
   * table into this process's memory before any of it is thrown away.
   */
  private static readonly MAX_RESULT_ROWS = 10000;

  private readonly client: LazyResource<OpenedClient>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning,
    tracer: StatementTracer
  ) {
    super(target, tracer);
    this.client = new LazyResource(
      () => this.open(),
      (opened) => opened.client.close()
    );
  }

  public async verify(): Promise<void> {
    await this.run("SELECT 1 AS ok");
  }

  public close(): Promise<void> {
    return this.client.close();
  }

  public async listDatabases(): Promise<DatabaseEntry[]> {
    const rows = (await this.run("SELECT name FROM system.databases ORDER BY name")) as { name: string }[];
    return rows.map((row) => ({ name: row.name, system: ClickHouseDriver.SYSTEM_DATABASES.has(row.name) }));
  }

  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const rows = (await this.run(
      "SELECT name FROM system.tables WHERE database = {database:String} ORDER BY name",
      { database: this.databaseName() }
    )) as { name: string }[];
    return new GlobPattern(pattern).apply(
      rows.map((row) => row.name),
      limit
    );
  }

  /** Identifier parameters: ClickHouse binds the table name itself, so nothing is interpolated. */
  public async describeObject(name: string): Promise<unknown> {
    const { database, table } = this.locate(name);
    await this.assertExists(database, table);
    return this.run("DESCRIBE TABLE {database:Identifier}.{table:Identifier}", { database, table });
  }

  /** ClickHouse has sorting and primary keys plus skipping indices, rather than B-tree indexes. */
  public async listIndexes(name: string): Promise<unknown> {
    const { database, table } = this.locate(name);
    await this.assertExists(database, table);
    const keys = await this.run(
      `SELECT partition_key, sorting_key, primary_key, sampling_key
       FROM system.tables WHERE database = {database:String} AND name = {table:String}`,
      { database, table }
    );
    const skipping = await this.run(
      `SELECT name, type, expr, granularity
       FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String}`,
      { database, table }
    );
    return { keys: keys[0] ?? {}, data_skipping_indices: skipping };
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    const { database, table } = this.locate(name);
    return this.run("SELECT * FROM {database:Identifier}.{table:Identifier} LIMIT {limit:UInt32}", {
      database,
      table,
      limit,
    });
  }

  public query(sql: string): Promise<unknown[]> {
    return this.run(sql);
  }

  private async run(sql: string, params?: Record<string, unknown>): Promise<unknown[]> {
    const { client, settings } = await this.client.get();
    return this.traced(sql, params, async () => {
      const result = await client.query({
        query: sql,
        format: "JSONEachRow",
        query_params: params,
        clickhouse_settings: settings,
      });
      return (await result.json()) as unknown[];
    });
  }

  private async assertExists(database: string, table: string): Promise<void> {
    const rows = await this.run(
      "SELECT 1 AS found FROM system.tables WHERE database = {database:String} AND name = {table:String}",
      { database, table }
    );
    if (rows.length === 0) {
      throw new ObjectNotFoundError(this.objectNoun, table);
    }
  }

  /** `db.table` names a table in another database; a bare name means the connection's own. */
  private locate(name: string): { database: string; table: string } {
    const qualified = SqlIdentifier.parse(name);
    return { database: qualified.schema ?? this.databaseName(), table: qualified.name };
  }

  private databaseName(): string {
    return this.target.database || EngineCatalog.describe("clickhouse").defaultDatabase;
  }

  /** Imported on first use; see MySqlDriver.createPool. */
  private async open(): Promise<OpenedClient> {
    const { createClient, ClickHouseLogLevel } = await import("@clickhouse/client");
    const secure = EngineCatalog.scheme(this.target.scheme).secure;

    const client = createClient({
      url: `${secure ? "https" : "http"}://${this.target.host}:${this.target.port}`,
      username: this.target.user || "default",
      password: this.target.password,
      database: this.databaseName(),
      application: "mcp-db-read-only",
      max_open_connections: this.tuning.connectionLimit,
      // Client-side, a little beyond the server-side limit, so the server's
      // own timeout error is what the user sees.
      request_timeout: this.tuning.queryTimeoutMs + 5000,
      // The client's own logger writes debug and info through console.debug
      // and console.info, which go to stdout, the JSON-RPC stream; one level
      // change would corrupt the protocol. Its error lines also carry query
      // context, which PRIVACY.md says is never logged. Every failure already
      // reaches the caller as a thrown error, so nothing is lost.
      log: { level: ClickHouseLogLevel.OFF },
    });

    try {
      return { client, settings: await this.negotiateSettings(client) };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  /**
   * Reads the account's own `readonly` level with no settings attached, since
   * attaching any is exactly what a read-only account refuses.
   */
  private async negotiateSettings(client: ClickHouseClient): Promise<ClickHouseSettings> {
    const probe = "SELECT toUInt8(getSetting('readonly')) AS readonly";
    const rows = (await this.traced(probe, undefined, async () =>
      (await client.query({ query: probe, format: "JSONEachRow" })).json()
    )) as { readonly: number | string }[];
    const level = Number(rows[0]?.readonly ?? 0);

    const limits: ClickHouseSettings = {
      max_execution_time: Math.max(1, Math.ceil(this.tuning.queryTimeoutMs / 1000)),
      max_result_rows: String(ClickHouseDriver.MAX_RESULT_ROWS),
      result_overflow_mode: "break",
    };

    if (level === 0) {
      return { ...limits, readonly: "2" };
    }
    if (level === 2) {
      return limits;
    }
    // readonly=1: the server already refuses writes, and refuses any setting.
    return {};
  }
}
