import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when a connection URL cannot be understood.
 *
 * The message never contains the URL itself. A URL is where the password
 * usually lives, and this message is shown to the user, logged to stderr, and
 * handed to the model. Callers describe the problem ("port is not a number")
 * without echoing the input that caused it.
 */
export class InvalidConnectionUrlError extends ApplicationError {
  constructor(reason: string) {
    super(`Invalid connection URL: ${reason}`);
  }
}
