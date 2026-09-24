import type { Engine } from "../domain/Engine.js";

/**
 * Where a profile came from. Surfaced to the user because it says whether the
 * connection will still exist after a restart.
 */
export type ProfileOrigin = "env" | "session";

/** One `host:port` pair. MongoDB is the only engine that accepts several. */
export interface HostAddress {
  readonly host: string;
  readonly port: number;
}

/**
 * The fully resolved fields of a connection. No optionals by design: every
 * default is applied by ConnectionTargetFactory before a target exists.
 *
 * `options` and `secretOptions` are both query-string parameters from the
 * connection URL. They are split at parse time because a parameter such as
 * `api_key` is a credential and must be kept out of every string that is
 * logged or displayed, exactly like the password.
 */
export interface ConnectionTargetProps {
  readonly engine: Engine;
  readonly scheme: string;
  readonly hosts: readonly HostAddress[];
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly options: Readonly<Record<string, string>>;
  readonly secretOptions: Readonly<Record<string, string>>;
}

/** One entry of the legacy MYSQL_PROFILES JSON, before defaults and validation. */
export interface RawMySqlProfileDefinition {
  readonly host?: unknown;
  readonly port?: unknown;
  readonly user?: unknown;
  readonly password?: unknown;
  readonly database?: unknown;
}

/** One entry of DB_PROFILES in its object form, before validation. */
export interface RawUrlProfileDefinition {
  readonly url?: unknown;
  readonly password?: unknown;
}

/** Everything needed to open a connection that is not part of its identity. */
export interface DriverTuning {
  readonly connectionLimit: number;
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
}
