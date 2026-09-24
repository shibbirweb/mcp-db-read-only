import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonSerializer } from "../../formatting/JsonSerializer.js";
import type { LogChannel } from "../LogChannel.js";
import type { CallRecord, StatementRecord } from "../LogRecords.js";
import { RecordJson } from "../RecordJson.js";
import { LogFileNames } from "./LogFileNames.js";
import type { StoredEntry } from "./LogStore.js";

/**
 * Saves every entry as its own JSON file in the permanent log folder.
 *
 * Each file is written under a temporary name and renamed into place, which
 * is atomic on one filesystem, so a reader (this process's viewer, another
 * copy's, or a person with `ls`) never sees a half-written file. Temporaries
 * end in `.tmp` and are ignored by LogFileNames.
 *
 * The folder is created readable by the owner only, and each file likewise:
 * with logging on they hold every query and every result.
 *
 * Synchronous for the same reason as FileSink: shutdown ends with
 * `process.exit`, which would lose buffered writes.
 *
 * Nothing is ever deleted or rotated here. The folder is permanent by design.
 */
export class FolderLogChannel implements LogChannel {
  private sequence = 0;

  /**
   * @param onWritten told of each entry just saved, so this process's own
   *   viewer can show it at once instead of waiting for its next scan.
   */
  constructor(
    private readonly directory: string,
    private readonly onWritten: (entry: StoredEntry) => void = () => undefined,
    private readonly serializer: JsonSerializer = new JsonSerializer()
  ) {}

  public get description(): string {
    return this.directory;
  }

  public onCall(call: CallRecord): void {
    const name = LogFileNames.build(call.at, call.pid, "call", ++this.sequence, call.tool, call.failed);
    this.save(name, "call", RecordJson.call(call));
  }

  public onStatement(statement: StatementRecord): void {
    const name = LogFileNames.build(statement.at, statement.pid, "statement", ++this.sequence, null, statement.failed);
    this.save(name, "statement", RecordJson.statement(statement));
  }

  private save(relativePath: string, kind: StoredEntry["kind"], data: Record<string, unknown>): void {
    const target = join(this.directory, relativePath);
    const day = join(this.directory, relativePath.split("/")[0]);
    mkdirSync(day, { recursive: true, mode: 0o700 });

    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, `${this.serializer.stringify(data)}\n`, { mode: 0o600 });
    renameSync(temporary, target);

    this.onWritten({ key: relativePath, kind, data });
  }
}
