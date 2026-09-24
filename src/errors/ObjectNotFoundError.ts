import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when a table, collection, key or index does not exist.
 *
 * Several engines answer a question about a missing table with an empty
 * result rather than an error, and an empty result reads as "it has no
 * columns". Saying plainly that it does not exist, and how to see what does,
 * gets the caller unstuck in one step.
 */
export class ObjectNotFoundError extends ApplicationError {
  constructor(noun: string, name: string) {
    super(`No ${noun} named "${name}" was found. Call list_tables to see what exists.`);
  }
}
