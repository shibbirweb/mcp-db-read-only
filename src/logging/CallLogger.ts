import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolResult } from "../types/tool.types.js";
import type { LogChannel } from "./LogChannel.js";
import type { CallRecord, StatementRecord } from "./LogRecords.js";
import { Redactor } from "./Redactor.js";
import type { StatementTracer, TracedStatement } from "./StatementTracer.js";
import type { ToolCallObserver } from "./ToolCallObserver.js";

/** The statements collected for the tool call currently running. */
interface CallContext {
  readonly statements: StatementRecord[];
}

/**
 * The call log: one entry per tool call, with every statement the drivers
 * sent while serving it.
 *
 * It is both halves of the logging interface. BaseTool hands it each call as
 * a ToolCallObserver, and drivers report each statement to it as a
 * StatementTracer. The two meet through AsyncLocalStorage: a call runs inside
 * its own context, so a statement reported anywhere beneath it, however many
 * awaits deep, lands on the right call without any id being passed through
 * the drivers. Calls handled concurrently each keep their own statements.
 *
 * A statement reported with no call around it (a MySQL connection's session
 * setup, fired by the pool) is written as an entry of its own.
 *
 * Each record goes to every channel: text to stderr or a file, the live
 * browser viewer, or both.
 *
 * Logging can never break a call. Any failure in a channel is caught; the
 * first one is reported once through the diagnostic logger and that channel
 * is then switched off for the rest of the process, rather than failing, say,
 * on every call once a disk fills up. The other channels carry on.
 */
export class CallLogger implements ToolCallObserver, StatementTracer {
  private readonly context = new AsyncLocalStorage<CallContext>();
  private nextId = 1;
  private readonly disabled = new Set<LogChannel>();

  constructor(
    private readonly channels: readonly LogChannel[],
    private readonly describeConnection: () => string | null,
    private readonly warn: (message: string) => void,
    /** The MCP client's name, known once it has completed the handshake. */
    private readonly describeClient: () => string | null = () => null,
    private readonly redactor: Redactor = new Redactor(),
    private readonly clock: () => number = () => Date.now()
  ) {}

  public async observe(tool: string, args: unknown, run: () => Promise<ToolResult>): Promise<ToolResult> {
    const id = this.nextId++;
    const started = this.clock();
    const connection = this.safely(() => this.describeConnection(), null);
    const context: CallContext = { statements: [] };

    const result = await this.context.run(context, run);

    const record = this.safely<CallRecord | null>(
      () => ({
        id,
        tool,
        pid: process.pid,
        client: this.safely(() => this.describeClient(), null),
        at: new Date(started),
        durationMs: this.clock() - started,
        connection,
        input: this.redactor.redact(args),
        output: result.content.map((block) => block.text).join("\n"),
        failed: Boolean(result.isError),
        statements: context.statements,
      }),
      null
    );
    if (record) {
      this.publish((channel) => channel.onCall(record));
    }

    return result;
  }

  public async trace<T>(
    engine: string,
    statement: TracedStatement,
    run: () => Promise<T>,
    describe: (result: T) => string = CallLogger.describe
  ): Promise<T> {
    const started = this.clock();
    try {
      const result = await run();
      this.add(engine, statement, started, this.safely(() => describe(result), "ok"), false);
      return result;
    } catch (error) {
      this.add(engine, statement, started, CallLogger.reason(error), true);
      throw error;
    }
  }

  public record(engine: string, statement: TracedStatement, durationMs: number, error?: unknown): void {
    const started = this.clock() - durationMs;
    this.add(engine, statement, started, error ? CallLogger.reason(error) : "ok", Boolean(error));
  }

  /** The default outcome: a row count for arrays, "ok" for everything else. */
  public static describe(result: unknown): string {
    if (Array.isArray(result)) {
      return `${result.length} row${result.length === 1 ? "" : "s"}`;
    }
    if (typeof result === "number") {
      return String(result);
    }
    return "ok";
  }

  private add(engine: string, statement: TracedStatement, started: number, outcome: string, failed: boolean): void {
    const record: StatementRecord = {
      pid: process.pid,
      client: this.safely(() => this.describeClient(), null),
      engine,
      text: statement.text,
      params: statement.params,
      at: new Date(started),
      durationMs: this.clock() - started,
      outcome,
      failed,
    };

    const current = this.context.getStore();
    if (current) {
      current.statements.push(record);
      return;
    }
    this.publish((channel) => channel.onStatement(record));
  }

  private publish(deliver: (channel: LogChannel) => void): void {
    for (const channel of this.channels) {
      if (this.disabled.has(channel)) {
        continue;
      }
      try {
        deliver(channel);
      } catch (error) {
        this.disabled.add(channel);
        this.warn(`call logging to ${channel.description} stopped after a failure: ${CallLogger.reason(error)}`);
      }
    }
  }

  private safely<T>(read: () => T, fallback: T): T {
    try {
      return read();
    } catch {
      return fallback;
    }
  }

  private static reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
