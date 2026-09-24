/** One database (schema, Redis index) as reported by `list_databases`. */
export interface DatabaseEntry {
  readonly name: string;
  /**
   * Internal databases such as `information_schema` or MongoDB's `local`.
   * Hidden by default because they are noise in almost every session.
   */
  readonly system: boolean;
}

/** The result of listing tables, collections, keys or indices. */
export interface ObjectListing {
  readonly names: string[];
  /** True when the listing stopped at its cap, so the reader knows it is partial. */
  readonly truncated: boolean;
}

/** A MongoDB `find`, after its filter has been validated. */
export interface FindRequest {
  readonly filter: Record<string, unknown>;
  readonly projection?: Record<string, unknown>;
  readonly sort?: Record<string, unknown>;
  readonly limit: number;
  readonly skip: number;
}

/**
 * A capped result: `rows` holds at most the cap, and `truncated` says whether
 * there were more. Returned by drivers that stream from a cursor, where the
 * true total is unknown without reading everything.
 */
export interface CappedRows {
  readonly rows: unknown[];
  readonly truncated: boolean;
}
