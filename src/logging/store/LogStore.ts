/** One logged entry as the viewer receives it: a stable key and the record's JSON. */
export interface StoredEntry {
  /** Unique across every copy of the server and across restarts. */
  readonly key: string;
  readonly kind: "call" | "statement";
  readonly data: Record<string, unknown>;
}

/** What the viewer asks for. Filters apply across everything stored, not just one page. */
export interface LogQuery {
  /** 1-based. */
  readonly page: number;
  readonly size: number;
  readonly tool?: string;
  readonly failedOnly?: boolean;
  /** Case-insensitive text anywhere in the entry. */
  readonly text?: string;
}

export interface LogPage {
  readonly entries: StoredEntry[];
  /** How many entries match the filters, across all pages. */
  readonly total: number;
  readonly page: number;
  readonly size: number;
  readonly pages: number;
}

/**
 * Where the viewer reads entries from, newest first.
 *
 * Two implementations: MemoryLogStore keeps this process's recent entries,
 * and FolderLogStore reads the saved files of every copy of the server that
 * shares the folder.
 */
export interface LogStore {
  query(query: LogQuery): Promise<LogPage>;
  /** Every tool name that appears in the store, for the viewer's tool filter. */
  tools(): Promise<string[]>;
  /** Called with each new entry as it arrives. Returns the unsubscribe function. */
  subscribe(listener: (entry: StoredEntry) => void): () => void;
  /** Begin watching for new entries, when there is anything to watch. */
  start(): void;
  stop(): void;
}

/** Pages and page counts, shared by both stores so they cannot disagree. */
export class Paging {
  public static readonly DEFAULT_SIZE = 20;
  public static readonly MAX_SIZE = 100;

  public static normalise(query: LogQuery): { page: number; size: number } {
    const size = Math.min(Math.max(Math.trunc(query.size) || Paging.DEFAULT_SIZE, 1), Paging.MAX_SIZE);
    const page = Math.max(Math.trunc(query.page) || 1, 1);
    return { page, size };
  }

  public static page<T>(matching: T[], query: LogQuery): { slice: T[]; total: number; page: number; size: number; pages: number } {
    const { page, size } = Paging.normalise(query);
    const total = matching.length;
    const pages = Math.max(Math.ceil(total / size), 1);
    const current = Math.min(page, pages);
    const start = (current - 1) * size;
    return { slice: matching.slice(start, start + size), total, page: current, size, pages };
  }
}
