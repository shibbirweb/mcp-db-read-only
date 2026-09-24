import { DatabaseSync } from "node:sqlite";
import type {
  SqliteRequest,
  SqliteResponse,
  SqliteStartup,
  SqliteWorkerOptions,
} from "./SqliteProtocol.js";

/**
 * Owns one read-only SQLite database, in a child process.
 *
 * node:sqlite is synchronous: a query runs on the calling thread until it
 * finishes, and there is no way to interrupt it from JavaScript. On the main
 * thread, one runaway query would freeze the whole MCP server.
 *
 * A child process rather than a worker thread, which was tried first and
 * failed: `worker.terminate()` stops JavaScript, but a thread inside
 * SQLite's native `sqlite3_step` never returns to JavaScript, so the
 * terminate waited forever and took the server with it. A process can always
 * be killed, whatever it is doing.
 *
 * The database is opened read-only at the file level, which is SQLite's own
 * guarantee and the second layer behind the SQL validator. `query_only` is set
 * as well, though it can be switched off from SQL and so is not relied on.
 *
 * stdout is never written: the parent does not even connect it, because the
 * parent's own stdout is the JSON-RPC stream.
 */

function send(message: SqliteStartup | SqliteResponse): void {
  process.send?.(message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Integers arrive as bigint so none is rounded on the way out. Those that fit
 * a double exactly go back to plain numbers here, which is nearly all of them.
 */
function normalise(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    out[column] =
      typeof value === "bigint" && Number.isSafeInteger(Number(value)) ? Number(value) : value;
  }
  return out;
}

// The parent going away closes the IPC channel. Exiting then means a killed
// or crashed server never leaves an orphan holding the database file open.
process.on("disconnect", () => process.exit(0));

const options = JSON.parse(process.argv[2] ?? "{}") as SqliteWorkerOptions;

let database: DatabaseSync;
try {
  database = new DatabaseSync(options.path, {
    readOnly: true,
    // Extensions are native code; loading one is the classic route out of
    // SQLite's sandbox.
    allowExtension: false,
    timeout: options.busyTimeoutMs,
    readBigInts: true,
  });
  database.exec("PRAGMA query_only = ON");
  send({ type: "ready" });
} catch (error) {
  send({ type: "failed", error: describe(error) });
  process.exit(0);
}

process.on("message", (request: SqliteRequest) => {
  let response: SqliteResponse;
  try {
    const rows = database.prepare(request.sql).all(...request.params) as Record<string, unknown>[];
    response = { id: request.id, rows: rows.map(normalise) };
  } catch (error) {
    response = { id: request.id, error: describe(error) };
  }
  send(response);
});
