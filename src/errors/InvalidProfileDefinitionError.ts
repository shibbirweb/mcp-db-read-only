import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised while parsing one entry of DB_PROFILES or MYSQL_PROFILES.
 *
 * Caught by the configuration loader and turned into a warning: one malformed
 * profile must not stop the server starting, because a running server can be
 * repaired with the connect tool while a dead one cannot be diagnosed at all.
 */
export class InvalidProfileDefinitionError extends ApplicationError {
  constructor(
    public readonly profileName: string,
    reason: string
  ) {
    super(`Profile "${profileName}" ${reason}`);
  }
}
