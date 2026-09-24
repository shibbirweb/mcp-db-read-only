import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when the active engine has no equivalent of what was asked.
 *
 * Redis has no foreign keys and Elasticsearch has no databases. These are not
 * failures of the server, so the message says what the engine does have
 * instead, which is usually what the caller wanted in the first place.
 */
export class UnsupportedOperationError extends ApplicationError {
  constructor(engineLabel: string, operation: string, alternative?: string) {
    const suffix = alternative ? ` ${alternative}` : "";
    super(`${engineLabel} has no ${operation}.${suffix}`);
  }
}
