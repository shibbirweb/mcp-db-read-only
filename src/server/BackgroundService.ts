/**
 * Something that runs alongside the MCP server for its whole life, such as
 * the live log viewer.
 *
 * `start` must never reject in a way that stops the MCP server: a helper that
 * cannot start (its port is taken, say) reports that and carries on without
 * itself. `stop` must never throw, since shutdown calls it.
 */
export interface BackgroundService {
  start(): Promise<void>;
  stop(): Promise<void>;
}
