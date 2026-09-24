import type { ConnectionProfile } from "../domain/ConnectionProfile.js";

/**
 * The result of reading configuration from somewhere.
 *
 * `warnings` are returned rather than logged so the loader stays pure and
 * testable; the composition root decides where they go. Nothing in here is
 * fatal: a server with no profiles at all is a valid, usable state.
 */
export interface LoadedConfiguration {
  readonly profiles: ConnectionProfile[];
  readonly defaultProfileName: string | null;
  readonly queryTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly logging: LoggingSettings;
  readonly warnings: string[];
}

/**
 * The optional call log. Off unless asked for, because with it on every
 * query and every result is written somewhere.
 */
export interface LoggingSettings {
  readonly enabled: boolean;
  /** Whether entries are also written as text: to `file`, or to stderr when `file` is null. */
  readonly text: boolean;
  /** An absolute path to append to, or null for stderr. */
  readonly file: string | null;
  /** The permanent log folder, one JSON file per entry, or null for none. */
  readonly directory: string | null;
  readonly format: "pretty" | "json";
  /** The live browser viewer's port, or null for no viewer. Only honoured while logging is enabled. */
  readonly viewerPort: number | null;
  /** How many recent entries the viewer keeps in memory when there is no log folder. */
  readonly viewerHistory: number;
}

/** Anything that can supply configuration. Lets tests bypass the environment. */
export interface ConfigurationLoader {
  load(): LoadedConfiguration;
}
