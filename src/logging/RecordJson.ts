import type { CallRecord, StatementRecord } from "./LogRecords.js";

/**
 * The one JSON shape of a record, used everywhere a record leaves the process
 * as data: JSON log lines, the saved files, and the live viewer.
 *
 * One definition, so a file written today reads back in the viewer exactly
 * as a live entry does, and a field added here appears in all three.
 */
export class RecordJson {
  public static call(call: CallRecord): Record<string, unknown> {
    return {
      type: "call",
      id: call.id,
      tool: call.tool,
      at: call.at.toISOString(),
      durationMs: call.durationMs,
      failed: call.failed,
      pid: call.pid,
      client: call.client,
      connection: call.connection,
      input: call.input,
      statements: call.statements.map((statement) => RecordJson.statementFields(statement)),
      output: call.output,
    };
  }

  public static statement(statement: StatementRecord): Record<string, unknown> {
    return { type: "statement", ...RecordJson.statementFields(statement), pid: statement.pid, client: statement.client };
  }

  private static statementFields(statement: StatementRecord): Record<string, unknown> {
    return {
      engine: statement.engine,
      at: statement.at.toISOString(),
      durationMs: statement.durationMs,
      failed: statement.failed,
      outcome: statement.outcome,
      text: statement.text,
      params: statement.params,
    };
  }
}
