/**
 * What the call log records, independent of how it is written out.
 *
 * Kept as plain data so the two formatters (pretty and JSON) render exactly
 * the same facts, and a test can assert on a record without parsing text.
 */

/**
 * Which copy of the server produced a record. An MCP client such as Claude
 * Desktop runs one copy per chat surface, and with a shared log folder their
 * entries sit side by side, so each says where it came from.
 */
export interface RecordOrigin {
  readonly pid: number;
  /** The MCP client's name from its handshake, e.g. "claude-ai", or null before one. */
  readonly client: string | null;
}

/** One statement a driver sent to its database, during a tool call or outside one. */
export interface StatementRecord extends RecordOrigin {
  /** The engine's label, e.g. "PostgreSQL". */
  readonly engine: string;
  /** SQL, a MongoDB operation, a Redis command, or an HTTP request line. */
  readonly text: string;
  /** Bound values, filters or a request body, where the statement has them. */
  readonly params?: unknown;
  readonly at: Date;
  readonly durationMs: number;
  /** "3 rows", "ok", or the error message. */
  readonly outcome: string;
  readonly failed: boolean;
}

/** One tool call, from arguments in to result out. */
export interface CallRecord extends RecordOrigin {
  /** Increments per call for the life of the process, to match a call to its statements. */
  readonly id: number;
  readonly tool: string;
  readonly at: Date;
  readonly durationMs: number;
  /** The active connection when the call began, as displayed elsewhere: never a password. */
  readonly connection: string | null;
  /** The arguments, after redaction. */
  readonly input: unknown;
  /** The full text returned to the client. */
  readonly output: string;
  readonly failed: boolean;
  readonly statements: readonly StatementRecord[];
}
