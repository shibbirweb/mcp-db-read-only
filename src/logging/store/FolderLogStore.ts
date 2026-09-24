import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LogFileNames, type LogFileInfo } from "./LogFileNames.js";
import { Paging, type LogPage, type LogQuery, type LogStore, type StoredEntry } from "./LogStore.js";

/**
 * Reads the permanent log folder for the viewer: every entry saved by every
 * copy of the server that shares it, newest first.
 *
 * **An index of file names, not contents.** On first use the folder is
 * listed once, and each name parsed (LogFileNames puts time, pid, tool and
 * outcome in it), so paging, the tool filter and "failed only" never open a
 * file. Only the entries on the page being shown are read, plus, for a text
 * search, the candidates it has to look inside.
 *
 * **New entries.** This process's own writes arrive at once through
 * `noteWritten`. Other copies' writes are found by rescanning today's folder
 * once a second: one small directory listing, dependable on every platform,
 * where `fs.watch` is not (it drops and duplicates events, and behaves
 * differently on network and bind-mounted folders). The timer is unref'd, so
 * it never keeps the process alive.
 *
 * Files deleted by hand disappear from the index the next time they would
 * have been read.
 */
export class FolderLogStore implements LogStore {
  private static readonly SCAN_INTERVAL_MS = 1000;

  private index: LogFileInfo[] | null = null;
  private readonly known = new Set<string>();
  /** Entries already pushed to the viewer, so the scan and noteWritten never push one twice. */
  private readonly emitted = new Set<string>();
  private readonly listeners = new Set<(entry: StoredEntry) => void>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly directory: string) {}

  public start(): void {
    if (this.timer) {
      return;
    }
    this.load();
    this.timer = setInterval(() => void this.scanRecent(), FolderLogStore.SCAN_INTERVAL_MS);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public subscribe(listener: (entry: StoredEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** An entry this process has just saved: index it and tell the viewer now. */
  public noteWritten(entry: StoredEntry): void {
    const [day, file] = entry.key.split("/");
    const info = LogFileNames.parse(day, file);
    if (!info) {
      return;
    }
    // Loaded first, so a write before the first query cannot leave the index
    // holding only this one entry and the rest of the folder unscanned.
    this.load();
    this.add(info);
    this.emit(entry);
  }

  public async tools(): Promise<string[]> {
    const names = new Set<string>();
    for (const info of this.load()) {
      if (info.tool) {
        names.add(info.tool);
      }
    }
    return Array.from(names).sort();
  }

  public async query(query: LogQuery): Promise<LogPage> {
    let candidates = this.load().filter(
      (info) =>
        (!query.tool || info.tool === query.tool) && (!query.failedOnly || info.failed)
    );

    const needle = query.text?.trim().toLowerCase();
    if (needle) {
      const matching: LogFileInfo[] = [];
      for (const info of candidates) {
        const text = await this.readText(info);
        if (text !== null && text.toLowerCase().includes(needle)) {
          matching.push(info);
        }
      }
      candidates = matching;
    }

    const paged = Paging.page(candidates, query);
    const entries: StoredEntry[] = [];
    for (const info of paged.slice) {
      const entry = await this.read(info);
      if (entry) {
        entries.push(entry);
      }
    }
    return { entries, total: paged.total, page: paged.page, size: paged.size, pages: paged.pages };
  }

  /** The index, built on first use: every day folder, every file, newest first. */
  private load(): LogFileInfo[] {
    if (this.index) {
      return this.index;
    }
    // Collected, then sorted once: inserting one at a time would be
    // quadratic in a folder that has been filling for months.
    const all: LogFileInfo[] = [];
    for (const day of this.listDays()) {
      for (const info of this.listDay(day)) {
        if (!this.known.has(info.relativePath)) {
          this.known.add(info.relativePath);
          all.push(info);
        }
      }
    }
    this.index = all.sort((a, b) => (this.newer(a, b) ? -1 : 1));
    return this.index;
  }

  /**
   * Today's folder, and yesterday's around midnight UTC, since a copy may
   * still be finishing a call dated the day before.
   */
  private async scanRecent(): Promise<void> {
    const now = new Date();
    const days = new Set([LogFileNames.dayFolder(now), LogFileNames.dayFolder(new Date(now.getTime() - 60000))]);
    for (const day of days) {
      for (const info of this.listDay(day)) {
        if (this.add(info)) {
          const entry = await this.read(info);
          if (entry) {
            this.emit(entry);
          }
        }
      }
    }
  }

  /** @returns true when the entry was new. Keeps the index newest first. */
  private add(info: LogFileInfo): boolean {
    if (this.known.has(info.relativePath)) {
      return false;
    }
    this.known.add(info.relativePath);
    const index = this.load();
    let at = 0;
    while (at < index.length && this.newer(index[at], info)) {
      at += 1;
    }
    index.splice(at, 0, info);
    return true;
  }

  /** Newest first by time; the name breaks ties, so the order is total and stable. */
  private newer(a: LogFileInfo, b: LogFileInfo): boolean {
    const difference = a.at.getTime() - b.at.getTime();
    return difference !== 0 ? difference > 0 : a.relativePath > b.relativePath;
  }

  private listDays(): string[] {
    if (!existsSync(this.directory)) {
      return [];
    }
    return readdirSync(this.directory).filter((name) => LogFileNames.isDayFolder(name));
  }

  private listDay(day: string): LogFileInfo[] {
    const folder = join(this.directory, day);
    if (!existsSync(folder)) {
      return [];
    }
    const found: LogFileInfo[] = [];
    for (const file of readdirSync(folder)) {
      const info = LogFileNames.parse(day, file);
      if (info) {
        found.push(info);
      }
    }
    return found;
  }

  private async read(info: LogFileInfo): Promise<StoredEntry | null> {
    const text = await this.readText(info);
    if (text === null) {
      return null;
    }
    try {
      return { key: info.relativePath, kind: info.kind, data: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  /** A file that has gone, deleted by hand, is dropped from the index. */
  private async readText(info: LogFileInfo): Promise<string | null> {
    try {
      return await readFile(join(this.directory, info.relativePath), "utf8");
    } catch {
      this.forget(info);
      return null;
    }
  }

  private forget(info: LogFileInfo): void {
    this.known.delete(info.relativePath);
    if (this.index) {
      this.index = this.index.filter((entry) => entry.relativePath !== info.relativePath);
    }
  }

  private emit(entry: StoredEntry): void {
    if (this.emitted.has(entry.key)) {
      return;
    }
    this.emitted.add(entry.key);
    for (const listener of this.listeners) {
      listener(entry);
    }
  }
}
