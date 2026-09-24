import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when a read is attempted before any connection has been chosen.
 *
 * Reaching this is normal rather than exceptional: the server starts happily
 * with no configuration, so the message has to double as the instructions for
 * getting out of that state.
 */
export class NoActiveConnectionError extends ApplicationError {
  constructor() {
    super(
      "No active connection. Call connect with a connection URL, or use_connection with a profile name."
    );
  }
}
