import { fork } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { SqlDriver } from "../DatabaseDriver.js";
import { GlobPattern } from "../GlobPattern.js";
import { LazyResource } from "../LazyResource.js";
import { SqlIdentifier } from "./SqlIdentifier.js";
import type {
  SqliteParameter,
  SqliteResponse,
  SqliteStartup,
  SqliteWorkerOptions,
} from "./SqliteProtocol.js";

/**
 * The server's side of one SQLite worker process: sends a statement, awaits
 * the rows, and kills the process when a statement overruns.
 */
class SqliteWorkerHandle {
  private static readonly ENTRY = fileURLToPath(new URL("./SqliteWorker.js", import.meta.url));

  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (rows: unknown[]) => void; reject: (error: Error) => void }
  >();
  private deadReason: string | null = null;

  private constructor(private readonly child: ChildProcess) {
    child.on("message", (response: SqliteResponse) => this.settle(response));
    child.on("error", (error) => this.fail(error.message));
    child.on("exit", () => this.fail("the SQLite worker exited"));
  }

  /**
   * Resolves once the database is open, so a missing file or a permissions
   * problem is reported by connect rather than by the first query.
   */
  public static start(options: SqliteWorkerOptions, timeoutMs: number): Promise<SqliteWorkerHandle> {
    const child = fork(SqliteWorkerHandle.ENTRY, [JSON.stringify(options)], {
      // stdout is ignored, never inherited: this process's stdout is the
      // JSON-RPC stream, and one stray byte from the child would corrupt it.
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      // Structured clone rather than JSON, so blobs arrive as bytes rather
      // than as an array of numbers.
      serialization: "advanced",
      // node:sqlite prints an ExperimentalWarning on first use. It is noise in
      // a client's log, and it says nothing an operator can act on.
      execArgv: ["--disable-warning=ExperimentalWarning"],
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Opening the SQLite database took longer than ${timeoutMs} ms.`));
      }, timeoutMs);

      child.once("message", (startup: SqliteStartup) => {
        clearTimeout(timer);
        if (startup.type === "ready") {
          resolve(new SqliteWorkerHandle(child));
          return;
        }
        child.kill("SIGKILL");
        reject(new Error(`Could not open SQLite database: ${startup.error}`));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  public get dead(): boolean {
    return this.deadReason !== null;
  }

  public run(sql: string, params: readonly SqliteParameter[], timeoutMs: number): Promise<unknown[]> {
    if (this.deadReason) {
      return Promise.reject(new Error(this.deadReason));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // The only way to stop a synchronous SQLite statement. The driver
        // opens a fresh process for the next call.
        this.fail(`Query exceeded ${timeoutMs} ms and was stopped.`);
        this.child.kill("SIGKILL");
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (rows) => {
          clearTimeout(timer);
          resolve(rows);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.send({ id, sql, params });
    });
  }

  /**
   * Not awaited beyond the signal: SIGKILL cannot be refused, and waiting on
   * the exit event is what hung the worker-thread version of this class.
   */
  public async terminate(): Promise<void> {
    this.fail("the SQLite connection was closed");
    this.child.kill("SIGKILL");
  }

  private settle(response: SqliteResponse): void {
    const waiter = this.pending.get(response.id);
    if (!waiter) {
      return;
    }
    this.pending.delete(response.id);
    if ("error" in response) {
      waiter.reject(new Error(response.error));
      return;
    }
    waiter.resolve(response.rows);
  }

  /** Every call in flight fails with the same reason, and so does every later one. */
  private fail(reason: string): void {
    if (!this.deadReason) {
      this.deadReason = reason;
    }
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

/**
 * SQLite, through the node:sqlite module built into Node 22.13 and later.
 *
 * Read-only layer two: the file is opened with SQLite's `readOnly` flag, so
 * the library refuses to write to it at all, whatever the statement says.
 * Extension loading is disabled.
 *
 * The database lives in a child process (see SqliteWorker), started on first
 * use and replaced after a query is killed for overrunning.
 *
 * No dependency is needed, which is also why SQLite needs no native module
 * build and works in the Alpine image on every architecture.
 */
export class SqliteDriver extends BaseDriver implements SqlDriver {
  public readonly family = "sql";
  public readonly dialect = "sqlite";

  private readonly worker: LazyResource<SqliteWorkerHandle>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning
  ) {
    super(target);
    this.worker = new LazyResource(
      () =>
        SqliteWorkerHandle.start(
          { path: target.database, busyTimeoutMs: tuning.connectTimeoutMs },
          tuning.connectTimeoutMs
        ),
      (handle) => handle.terminate()
    );
  }

  public async verify(): Promise<void> {
    await this.run("SELECT 1");
  }

  public close(): Promise<void> {
    return this.worker.close();
  }

  public async listDatabases(): Promise<DatabaseEntry[]> {
    const rows = (await this.run("SELECT name FROM pragma_database_list")) as { name: string }[];
    return rows.map((row) => ({ name: row.name, system: row.name === "temp" }));
  }

  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const rows = (await this.run(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )) as { name: string }[];
    return new GlobPattern(pattern).apply(
      rows.map((row) => row.name),
      limit
    );
  }

  public async describeObject(name: string): Promise<unknown> {
    const rows = await this.pragma("table_info", name);
    if (rows.length === 0) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
    return rows;
  }

  public async listIndexes(name: string): Promise<unknown> {
    await this.describeObject(name);
    const qualified = SqlIdentifier.parse(name);
    return this.run(
      `SELECT il.name AS index_name, il."unique" AS is_unique, il.origin, ii.seqno, ii.name AS column_name
       FROM pragma_index_list(?, ?) il JOIN pragma_index_info(il.name, ?) ii
       ORDER BY il.name, ii.seqno`,
      [qualified.name, qualified.schema ?? "main", qualified.schema ?? "main"]
    );
  }

  public async listForeignKeys(name: string): Promise<unknown[]> {
    await this.describeObject(name);
    return this.pragma("foreign_key_list", name);
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    const table = SqlIdentifier.quoteQualified(SqlIdentifier.parse(name), SqlIdentifier.doubleQuote);
    return this.run(`SELECT * FROM ${table} LIMIT ?`, [limit]);
  }

  public query(sql: string): Promise<unknown[]> {
    return this.run(sql);
  }

  /** Table-valued pragma functions, so the table name is a bound value, not SQL. */
  private pragma(pragmaName: "table_info" | "foreign_key_list", name: string): Promise<unknown[]> {
    const qualified = SqlIdentifier.parse(name);
    return this.run(`SELECT * FROM pragma_${pragmaName}(?, ?)`, [
      qualified.name,
      qualified.schema ?? "main",
    ]);
  }

  /** A worker that died, including one stopped for overrunning, is replaced on the next call. */
  private async run(sql: string, params: SqliteParameter[] = []): Promise<unknown[]> {
    const handle = await this.worker.get();
    try {
      return await handle.run(sql, params, this.tuning.queryTimeoutMs);
    } catch (error) {
      if (handle.dead) {
        await this.worker.reset();
      }
      throw error;
    }
  }
}
