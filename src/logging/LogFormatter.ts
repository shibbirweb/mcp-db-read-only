import { JsonSerializer } from "../formatting/JsonSerializer.js";
import type { CallRecord, StatementRecord } from "./LogRecords.js";
import { RecordJson } from "./RecordJson.js";

/** Turns records into the text a sink writes. One entry per call or stray statement. */
export interface LogFormatter {
  formatCall(call: CallRecord): string;
  /** A statement with no tool call around it, such as MySQL's per-connection setup. */
  formatStatement(statement: StatementRecord): string;
}

/**
 * For reading: one boxed block per call, with the input, every statement the
 * drivers sent, and the full output, each indented under its heading.
 *
 * ```
 * ┌─ #3 run_query · ok · 38 ms · 2026-09-25T10:14:03.221Z
 * │ connection  dev (MySQL) mysql://root@127.0.0.1:3306/app
 * │ input
 * │   { "query": "SELECT COUNT(*) AS n FROM members" }
 * │ statements (1)
 * │   1. MySQL · 12 ms · 1 row
 * │      SELECT COUNT(*) AS n FROM members
 * │ output
 * │   [ { "n": 17440 } ]
 * └─
 * ```
 */
export class PrettyLogFormatter implements LogFormatter {
  constructor(private readonly serializer: JsonSerializer = new JsonSerializer()) {}

  public formatCall(call: CallRecord): string {
    const lines: string[] = [];
    const status = call.failed ? "FAILED" : "ok";
    lines.push(`┌─ #${call.id} ${call.tool} · ${status} · ${call.durationMs} ms · ${call.at.toISOString()}`);
    lines.push(`│ connection  ${call.connection ?? "none"}`);
    lines.push(`│ process     ${call.client ?? "unknown client"}, pid ${call.pid}`);
    lines.push("│ input");
    lines.push(...this.indent(this.serializer.stringify(call.input), "│   "));

    if (call.statements.length > 0) {
      lines.push(`│ statements (${call.statements.length})`);
      call.statements.forEach((statement, index) => {
        lines.push(`│   ${index + 1}. ${this.summary(statement)}`);
        lines.push(...this.statementBody(statement, "│      "));
      });
    }

    lines.push(call.failed ? "│ error" : "│ output");
    lines.push(...this.indent(call.output, "│   "));
    lines.push("└─");
    return `${lines.join("\n")}\n`;
  }

  public formatStatement(statement: StatementRecord): string {
    const lines = [`· statement outside a tool call · ${this.summary(statement)} · ${statement.at.toISOString()}`];
    lines.push(...this.statementBody(statement, "    "));
    return `${lines.join("\n")}\n`;
  }

  private summary(statement: StatementRecord): string {
    const outcome = statement.failed ? `FAILED: ${statement.outcome}` : statement.outcome;
    return `${statement.engine} · ${statement.durationMs} ms · ${outcome}`;
  }

  private statementBody(statement: StatementRecord, prefix: string): string[] {
    const lines = this.indent(statement.text, prefix);
    if (statement.params !== undefined) {
      lines.push(...this.indent(`params ${this.serializer.stringify(statement.params, 0)}`, prefix));
    }
    return lines;
  }

  private indent(text: string, prefix: string): string[] {
    return text.split("\n").map((line) => `${prefix}${line}`);
  }
}

/**
 * For machines: one JSON object per line, so `grep`, `jq` and log shippers
 * can read it without knowing anything about this server.
 */
export class JsonLogFormatter implements LogFormatter {
  constructor(private readonly serializer: JsonSerializer = new JsonSerializer()) {}

  public formatCall(call: CallRecord): string {
    return `${this.serializer.stringify(RecordJson.call(call), 0)}\n`;
  }

  public formatStatement(statement: StatementRecord): string {
    return `${this.serializer.stringify(RecordJson.statement(statement), 0)}\n`;
  }
}
