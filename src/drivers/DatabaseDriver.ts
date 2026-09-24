import type { ConnectionTarget } from "../domain/ConnectionTarget.js";
import type { EngineFamily } from "../domain/Engine.js";
import type { SqlDialectName } from "../validation/sql/SqlDialect.js";
import type {
  CappedRows,
  DatabaseEntry,
  FindRequest,
  ObjectListing,
} from "../types/driver.types.js";

/**
 * One open connection to one target, on any engine: the Strategy each engine
 * implements.
 *
 * These are the operations every engine can answer in its own terms, which is
 * what lets the browse tools be engine-agnostic. `listObjects` lists tables on
 * MySQL, collections on MongoDB, keys on Redis and indices on Elasticsearch;
 * the tool calling it neither knows nor cares which.
 *
 * Operations an engine has no equivalent for (foreign keys on Redis) throw
 * UnsupportedOperationError with a message naming what it has instead.
 *
 * A driver opens its connection lazily, on first use. Constructing one does no
 * I/O, so tools can resolve a driver before deciding a call is invalid, and a
 * rejected call still costs no connection.
 */
export interface DatabaseDriver {
  readonly family: EngineFamily;
  readonly target: ConnectionTarget;

  /**
   * Open the connection and prove it works. Called before a switch is
   * committed, so a bad host or database fails at the moment it is requested.
   */
  verify(): Promise<void>;

  /** Release every socket. Must never throw, since shutdown calls it. */
  close(): Promise<void>;

  listDatabases(): Promise<DatabaseEntry[]>;
  listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing>;
  describeObject(name: string): Promise<unknown>;
  listIndexes(name: string): Promise<unknown>;
  listForeignKeys(name: string): Promise<unknown[]>;
  sample(name: string, limit: number): Promise<unknown>;
}

/** MySQL, PostgreSQL, SQLite, SQL Server and ClickHouse. */
export interface SqlDriver extends DatabaseDriver {
  readonly family: "sql";
  /** Which validator run_query must apply before calling `query`. */
  readonly dialect: SqlDialectName;
  /**
   * Run one statement that has already passed the dialect's validator.
   *
   * Every implementation also enforces read-only server-side, independently
   * of the validator, which is what the integration tests prove by calling
   * this directly with a write.
   */
  query(sql: string): Promise<unknown[]>;
}

/** MongoDB. */
export interface DocumentDriver extends DatabaseDriver {
  readonly family: "document";
  find(collection: string, request: FindRequest): Promise<unknown[]>;
  aggregate(collection: string, pipeline: Record<string, unknown>[], limit: number): Promise<CappedRows>;
  count(collection: string, filter: Record<string, unknown>): Promise<number>;
  distinct(collection: string, field: string, filter: Record<string, unknown>): Promise<unknown[]>;
}

/** Redis. */
export interface KeyValueDriver extends DatabaseDriver {
  readonly family: "keyvalue";
  /**
   * Run one command that has already passed the allowlist. The driver asks
   * the server whether it is flagged read-only before sending it.
   */
  command(name: string, args: readonly string[]): Promise<unknown>;
}

/** Elasticsearch and OpenSearch. */
export interface SearchDriver extends DatabaseDriver {
  readonly family: "search";
  search(index: string, body: Record<string, unknown>): Promise<unknown>;
}
