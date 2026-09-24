import type { LogChannel } from "../LogChannel.js";
import type { CallRecord, StatementRecord } from "../LogRecords.js";
import { RecordJson } from "../RecordJson.js";
import { Paging, type LogPage, type LogQuery, type LogStore, type StoredEntry } from "./LogStore.js";

interface MemoryEntry extends StoredEntry {
  /** The entry as lower-case text, computed once, for the text filter. */
  readonly search: string;
}

/**
 * The viewer's store when no log folder is configured: this process's most
 * recent entries, in memory only, oldest dropped first past the capacity.
 *
 * A LogChannel as well, since without a folder there is nothing else to read
 * entries back from: it is fed directly by the call logger.
 */
export class MemoryLogStore implements LogStore, LogChannel {
  public readonly description = "the live viewer's memory";

  private readonly entries: MemoryEntry[] = [];
  private readonly listeners = new Set<(entry: StoredEntry) => void>();

  constructor(private readonly capacity: number) {}

  public onCall(call: CallRecord): void {
    this.add({ key: `m:${call.pid}:c${call.id}`, kind: "call", data: RecordJson.call(call) });
  }

  public onStatement(statement: StatementRecord): void {
    this.add({ key: `m:${statement.pid}:s${statement.at.getTime()}:${this.entries.length}`, kind: "statement", data: RecordJson.statement(statement) });
  }

  public start(): void {
    return;
  }

  public stop(): void {
    return;
  }

  public subscribe(listener: (entry: StoredEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async tools(): Promise<string[]> {
    const names = new Set<string>();
    for (const entry of this.entries) {
      if (entry.kind === "call") {
        names.add(String(entry.data.tool));
      }
    }
    return Array.from(names).sort();
  }

  public async query(query: LogQuery): Promise<LogPage> {
    const needle = query.text?.trim().toLowerCase();
    const matching = this.entries
      .filter(
        (entry) =>
          (!query.tool || (entry.kind === "call" && entry.data.tool === query.tool)) &&
          (!query.failedOnly || entry.data.failed === true) &&
          (!needle || entry.search.includes(needle))
      )
      .reverse();
    const paged = Paging.page(matching, query);
    return {
      entries: paged.slice.map(({ key, kind, data }) => ({ key, kind, data })),
      total: paged.total,
      page: paged.page,
      size: paged.size,
      pages: paged.pages,
    };
  }

  private add(entry: StoredEntry): void {
    if (this.capacity > 0) {
      this.entries.push({ ...entry, search: JSON.stringify(entry.data).toLowerCase() });
      if (this.entries.length > this.capacity) {
        this.entries.splice(0, this.entries.length - this.capacity);
      }
    }
    for (const listener of this.listeners) {
      listener(entry);
    }
  }
}
