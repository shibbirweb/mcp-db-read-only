/** A statement about to be sent, as the driver describes it. */
export interface TracedStatement {
  readonly text: string;
  readonly params?: unknown;
}

/**
 * The narrow interface drivers use to report what they send to a database.
 *
 * Drivers depend on this and nothing else from the logging module, so a
 * driver neither knows nor cares whether logging is on. When it is off, the
 * tracer is SilentTracer and `trace` is a direct call.
 */
export interface StatementTracer {
  /**
   * Run one statement and record it.
   *
   * @param describe turns a successful result into the outcome shown in the
   *   log ("3 rows"). The default counts arrays and says "ok" otherwise.
   */
  trace<T>(
    engine: string,
    statement: TracedStatement,
    run: () => Promise<T>,
    describe?: (result: T) => string
  ): Promise<T>;

  /**
   * Record a statement that has already run, for callback-style code that
   * cannot be wrapped in a promise, such as MySQL's per-connection setup.
   */
  record(engine: string, statement: TracedStatement, durationMs: number, error?: unknown): void;
}

/** The tracer when logging is off: no records, no timing, no overhead beyond one call. */
export class SilentTracer implements StatementTracer {
  public trace<T>(_engine: string, _statement: TracedStatement, run: () => Promise<T>): Promise<T> {
    return run();
  }

  public record(): void {
    return;
  }
}
