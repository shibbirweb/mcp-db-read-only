import { ReadOnlyQueryValidator } from "./ReadOnlyQueryValidator.js";
import { SqlDialects } from "./SqlDialect.js";
import type { SqlDialectName } from "./SqlDialect.js";

/**
 * One validator per SQL dialect, built once.
 *
 * run_query learns the dialect from the driver it is about to use, so it
 * needs a way to get the matching validator without constructing one on
 * every call or knowing how validators are assembled.
 */
export class SqlValidatorRegistry {
  private readonly validators = new Map<SqlDialectName, ReadOnlyQueryValidator>();

  constructor() {
    for (const dialect of SqlDialects.all()) {
      this.validators.set(dialect.name, new ReadOnlyQueryValidator(dialect));
    }
  }

  public for(dialect: SqlDialectName): ReadOnlyQueryValidator {
    const validator = this.validators.get(dialect);
    if (!validator) {
      throw new Error(`No validator for SQL dialect "${dialect}".`);
    }
    return validator;
  }
}
