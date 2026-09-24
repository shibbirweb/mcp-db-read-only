import { appendFileSync } from "node:fs";

/** Where finished log entries go. */
export interface LogSink {
  /** Shown once at startup, so the operator knows where to look. */
  readonly description: string;
  /** @throws when the entry could not be written; CallLogger handles it. */
  write(entry: string): void;
}

/**
 * The MCP client's own log.
 *
 * stderr, never stdout: stdout carries the JSON-RPC stream, and one log line
 * there would corrupt the protocol. Claude Code, for one, keeps each MCP
 * server's stderr in its MCP logs.
 */
export class StderrSink implements LogSink {
  public readonly description = "stderr";

  public write(entry: string): void {
    process.stderr.write(entry.endsWith("\n") ? entry : `${entry}\n`);
  }
}

/**
 * A file, appended to.
 *
 * Synchronous on purpose. Shutdown ends with `process.exit`, which does not
 * wait for a buffered stream to drain, so an asynchronous writer loses the
 * last calls of a session: usually the ones someone opened the log to find.
 * The cost is a blocking write per call, which is small next to a database
 * round trip.
 *
 * Created readable by the owner only, since with logging on it holds every
 * query and every result.
 */
export class FileSink implements LogSink {
  constructor(private readonly path: string) {}

  public get description(): string {
    return this.path;
  }

  public write(entry: string): void {
    appendFileSync(this.path, entry.endsWith("\n") ? entry : `${entry}\n`, { mode: 0o600 });
  }
}
