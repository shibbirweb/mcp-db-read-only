import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when a connection URL named no database and the operation needs one.
 *
 * A URL without a database is legitimate, and common for MongoDB and SQL
 * Server, so it is accepted at connect time. The error is deferred to the
 * first operation that genuinely needs a database, and says how to pick one.
 */
export class NoDatabaseSelectedError extends ApplicationError {
  constructor(engineLabel: string) {
    super(
      `No database selected on this ${engineLabel} connection. Call list_databases, then use_database, or pass the database argument.`
    );
  }
}
