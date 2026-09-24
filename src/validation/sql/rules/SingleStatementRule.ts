import type { QueryInspection, ValidationResult, ValidationRule } from "../../../types/validation.types.js";

/**
 * Rejects stacked statements.
 *
 * Because the skeleton has literals and comments blanked, any remaining `;` is
 * a real separator. A trailing one is already stripped before rules run, since
 * people routinely paste queries that way.
 *
 * On most engines this is a better error message rather than the actual
 * protection, because the driver cannot send a second statement at all
 * (mysql2 with multipleStatements off, pg in extended query mode, one query
 * per ClickHouse HTTP request). SQLite is the exception worth knowing: its
 * prepare silently ignores everything after the first statement, so without
 * this rule `SELECT 1; DELETE FROM t` would run the SELECT and report success.
 */
export class SingleStatementRule implements ValidationRule {
  public readonly name = "single-statement";

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (inspection.skeleton.includes(";")) {
      return {
        valid: false,
        error: "Multiple statements are not allowed. Send one query at a time.",
      };
    }
    return null;
  }
}
