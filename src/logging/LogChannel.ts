import type { CallRecord, StatementRecord } from "./LogRecords.js";
import type { LogFormatter } from "./LogFormatter.js";
import type { LogSink } from "./LogSink.js";

/**
 * One place finished records go: text to stderr or a file, or the live
 * browser viewer.
 *
 * CallLogger builds each record once, already redacted, and hands the same
 * object to every channel. A channel therefore cannot see anything the others
 * do not, and cannot forget the redaction.
 */
export interface LogChannel {
  /** Shown in warnings, so an operator knows which output failed. */
  readonly description: string;
  onCall(call: CallRecord): void;
  onStatement(statement: StatementRecord): void;
}

/** Formats records as text and writes them to a sink. */
export class TextLogChannel implements LogChannel {
  constructor(
    private readonly sink: LogSink,
    private readonly formatter: LogFormatter
  ) {}

  public get description(): string {
    return this.sink.description;
  }

  public onCall(call: CallRecord): void {
    this.sink.write(this.formatter.formatCall(call));
  }

  public onStatement(statement: StatementRecord): void {
    this.sink.write(this.formatter.formatStatement(statement));
  }
}
