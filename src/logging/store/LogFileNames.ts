/** What a log file's name says about it, without opening it. */
export interface LogFileInfo {
  /** The path relative to the log folder, e.g. `2026-09-25/103014-221Z_p72440_c000012_run_query_ok.json`. */
  readonly relativePath: string;
  readonly at: Date;
  readonly pid: number;
  readonly kind: "call" | "statement";
  /** The tool name for a call, null for a statement outside one. */
  readonly tool: string | null;
  readonly failed: boolean;
}

/**
 * Names log files so that everything the viewer lists and filters on is in
 * the name itself.
 *
 * `YYYY-MM-DD/HHMMSS-mmmZ_p<pid>_<c|s><sequence>_<tool>_<ok|failed>.json`
 *
 * - **A folder per UTC day**, so no single folder grows to tens of thousands
 *   of entries, and old days can be archived or deleted as a whole.
 * - **Time first**, so names sort chronologically; the `Z` says it is UTC.
 * - **The pid and a per-process sequence**, so several copies of the server
 *   writing to one folder can never produce the same name.
 * - **The tool and outcome last**, so paging, the tool filter and "failed
 *   only" read directory listings and never open a file. Only a text search
 *   reads contents.
 */
export class LogFileNames {
  private static readonly DAY = /^\d{4}-\d{2}-\d{2}$/;
  private static readonly FILE =
    /^(\d{2})(\d{2})(\d{2})-(\d{3})Z_p(\d+)_([cs])(\d+)_([A-Za-z0-9_-]+?)_(ok|failed)\.json$/;

  public static dayFolder(at: Date): string {
    return at.toISOString().slice(0, 10);
  }

  public static build(at: Date, pid: number, kind: "call" | "statement", sequence: number, tool: string | null, failed: boolean): string {
    const iso = at.toISOString();
    const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}-${iso.slice(20, 23)}Z`;
    const marker = kind === "call" ? "c" : "s";
    const label = kind === "call" ? LogFileNames.safe(tool ?? "call") : "statement";
    return `${LogFileNames.dayFolder(at)}/${time}_p${pid}_${marker}${String(sequence).padStart(6, "0")}_${label}_${failed ? "failed" : "ok"}.json`;
  }

  public static isDayFolder(name: string): boolean {
    return LogFileNames.DAY.test(name);
  }

  /** @returns null for anything that is not one of our files, including half-written temporaries. */
  public static parse(day: string, file: string): LogFileInfo | null {
    const match = LogFileNames.FILE.exec(file);
    if (!match || !LogFileNames.isDayFolder(day)) {
      return null;
    }
    const [, hh, mm, ss, ms, pid, marker, , label, outcome] = match;
    const at = new Date(`${day}T${hh}:${mm}:${ss}.${ms}Z`);
    if (Number.isNaN(at.getTime())) {
      return null;
    }
    const kind = marker === "c" ? "call" : "statement";
    return {
      relativePath: `${day}/${file}`,
      at,
      pid: Number(pid),
      kind,
      tool: kind === "call" ? label : null,
      failed: outcome === "failed",
    };
  }

  /** Tool names are already safe; this keeps any future one from reaching the path as-is. */
  private static safe(name: string): string {
    return name.replace(/[^A-Za-z0-9_-]/g, "-") || "call";
  }
}
