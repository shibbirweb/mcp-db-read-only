import type { Pool } from "mysql2/promise";
import type { StatementTracer } from "../../logging/StatementTracer.js";

/**
 * The connection this module actually deals with: the callback-API one.
 *
 * mysql2's promise typings declare the pool's `connection` event as handing
 * over the promise-API `PoolConnection`, but `PromisePool` re-emits the core
 * pool's event with its arguments untouched, so what arrives is the core
 * connection, whose `query` takes a callback. The event is the only place the
 * two APIs meet, so the correction is applied there and nowhere else.
 */
type CoreConnection = {
  query: (sql: string, callback: (error: unknown) => void) => void;
};

/**
 * Applies the server-side half of the read-only guarantee to every connection
 * a MySQL or MariaDB pool opens.
 *
 * Separated from the driver because it is the security-critical part and
 * deserves to be findable on its own. The driver decides *when* connections
 * exist; this decides *what they are allowed to do*.
 *
 * This is the layer that holds if the SQL validator is ever wrong. The two are
 * independent by design: a parser bug should not automatically be a write.
 */
export class MySqlSessionInitializer {
  /**
   * Removes the two sql_mode flags that change how quotes are read, so the
   * server lexes a statement exactly as the validator did.
   *
   * With NO_BACKSLASH_ESCAPES, `'a\'` is a complete string to the server but
   * an unfinished one to the validator. With ANSI_QUOTES, `"..."` is an
   * identifier, which takes no backslash escapes. Either mismatch lets text
   * the validator took for a literal run as SQL. ANSI and the old combination
   * modes are removed too, because each re-enables ANSI_QUOTES.
   *
   * One statement, built from string functions, because the pool may hand the
   * connection out as soon as this event returns; a read followed by a
   * separate write would race the first query.
   */
  private static readonly ALIGN_SQL_MODE = `SET SESSION sql_mode = TRIM(BOTH ',' FROM ${[
    "NO_BACKSLASH_ESCAPES",
    "ANSI_QUOTES",
    "ANSI",
    "DB2",
    "MAXDB",
    "MSSQL",
    "ORACLE",
    "POSTGRESQL",
  ].reduce(
    (expression, mode) => `REPLACE(${expression}, ',${mode},', ',')`,
    "CONCAT(',', @@SESSION.sql_mode, ',')"
  )})`;

  /** MariaDB's name for the variable; MySQL rejects it with error 1193. */
  private static readonly UNKNOWN_VARIABLE = 1193;

  /**
   * @param tracer records each setup statement in the call log, when it is
   *   on. They run on the pool's own schedule, so they usually appear as
   *   entries of their own rather than under the call that opened the
   *   connection.
   */
  constructor(
    private readonly queryTimeoutMs: number,
    private readonly logger: (message: string) => void,
    private readonly tracer: StatementTracer,
    private readonly engineLabel: string
  ) {}

  /**
   * Hooks the pool's `connection` event, which fires once per physical
   * connection. Once per connection rather than once per query, and it also
   * covers connections opened later as the pool grows.
   */
  public attachTo(pool: Pool): void {
    pool.on("connection", (connection) => {
      const coreConnection = connection as unknown as CoreConnection;

      // SET SESSION TRANSACTION READ ONLY sets the access mode for subsequent
      // transactions. With autocommit on, every statement is its own
      // transaction, so MySQL rejects any write with error 1792. It cannot be
      // undone from a query: SET is not an allowed leading keyword, and
      // statement stacking is impossible with multipleStatements disabled.
      this.apply(coreConnection, "SET SESSION TRANSACTION READ ONLY", "set read-only session");

      this.apply(coreConnection, MySqlSessionInitializer.ALIGN_SQL_MODE, "align sql_mode");

      this.applyTimeout(coreConnection);
    });
  }

  /**
   * Caps SELECT execution server-side so a runaway query is killed by the
   * server instead of hanging the conversation. MySQL calls it
   * MAX_EXECUTION_TIME in milliseconds, MariaDB max_statement_time in seconds.
   *
   * On MariaDB the fallback is queued only after MySQL's name is refused, so
   * the very first query on a new connection can run before it applies. That
   * gap affects only the timeout, never the read-only mode set above.
   */
  private applyTimeout(connection: CoreConnection): void {
    const sql = `SET SESSION MAX_EXECUTION_TIME = ${this.queryTimeoutMs}`;
    const started = Date.now();
    connection.query(sql, (error) => {
      this.tracer.record(this.engineLabel, { text: sql }, Date.now() - started, error ?? undefined);
      if (!error) {
        return;
      }
      if ((error as { errno?: number }).errno === MySqlSessionInitializer.UNKNOWN_VARIABLE) {
        this.apply(
          connection,
          `SET SESSION max_statement_time = ${this.queryTimeoutMs / 1000}`,
          "set statement timeout"
        );
        return;
      }
      this.logger(`could not set statement timeout: ${String(error)}`);
    });
  }

  /**
   * Failures are logged, never thrown.
   *
   * A pool `connection` event handler has nowhere to propagate a rejection to,
   * so an unhandled one would take the process down. A connection that could
   * not be set read-only is still guarded by the validator, so continuing is
   * correct; crashing on a server variant lacking one of these variables is
   * not.
   */
  private apply(connection: CoreConnection, sql: string, description: string): void {
    const started = Date.now();
    connection.query(sql, (error: unknown) => {
      this.tracer.record(this.engineLabel, { text: sql }, Date.now() - started, error ?? undefined);
      if (error) {
        this.logger(`could not ${description}: ${String(error)}`);
      }
    });
  }
}
