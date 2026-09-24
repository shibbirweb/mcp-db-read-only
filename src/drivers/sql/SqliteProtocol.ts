/**
 * Messages between SqliteDriver and the worker process that owns the database.
 *
 * Kept in their own module so both sides import one definition, rather than
 * two files agreeing on a shape by coincidence.
 */

export interface SqliteWorkerOptions {
  readonly path: string;
  /** How long to wait on a lock held by another process before giving up. */
  readonly busyTimeoutMs: number;
}

export type SqliteParameter = string | number | null;

export interface SqliteRequest {
  readonly id: number;
  readonly sql: string;
  readonly params: readonly SqliteParameter[];
}

export type SqliteResponse =
  | { readonly id: number; readonly rows: unknown[] }
  | { readonly id: number; readonly error: string };

export type SqliteStartup = { readonly type: "ready" } | { readonly type: "failed"; readonly error: string };
