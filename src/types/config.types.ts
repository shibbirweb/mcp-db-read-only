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
  readonly warnings: string[];
}

/** Anything that can supply configuration. Lets tests bypass the environment. */
export interface ConfigurationLoader {
  load(): LoadedConfiguration;
}
