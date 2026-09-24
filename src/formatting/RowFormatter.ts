import { JsonSerializer } from "./JsonSerializer.js";

/**
 * Renders query results for a conversation.
 *
 * Truncation protects the context window: `SELECT *` on a large table would
 * otherwise flood the transcript and can exceed the client's message limit
 * outright.
 *
 * This truncates *output*. Bounding the work the database does is the job of
 * each driver's server-side timeout.
 */
export class RowFormatter {
  public static readonly DEFAULT_MAX_ROWS = 100;

  constructor(
    private readonly maxRows: number = RowFormatter.DEFAULT_MAX_ROWS,
    private readonly serializer: JsonSerializer = new JsonSerializer()
  ) {}

  /**
   * @param narrowing how to ask for fewer rows on this engine ("Add a LIMIT
   *   clause"), so the note names the fix in the caller's own terms.
   * @param moreBeyond set when a driver already stopped reading at the cap,
   *   so the true total is unknown but known to be larger.
   */
  public format(rows: unknown[], narrowing: string, moreBeyond = false): string {
    const truncated = rows.length > this.maxRows;
    const shown = truncated ? rows.slice(0, this.maxRows) : rows;
    const body = this.serializer.stringify(shown);

    if (truncated) {
      // The note states the true total, so the reader knows they are seeing
      // a sample and how large the whole is.
      return `${body}\n\n--- Showing ${this.maxRows} of ${rows.length} rows. ${narrowing} for smaller results. ---`;
    }
    if (moreBeyond) {
      return `${body}\n\n--- Showing the first ${shown.length} results; there are more. ${narrowing} for smaller results. ---`;
    }
    return body;
  }

  public get limit(): number {
    return this.maxRows;
  }
}
