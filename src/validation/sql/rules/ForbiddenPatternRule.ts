import type { QueryInspection, ValidationResult, ValidationRule } from "../../../types/validation.types.js";

/**
 * Blocks constructs that are harmful even inside an otherwise read-only
 * statement.
 *
 * These begin with SELECT and pass every rule above. They write files
 * (`INTO OUTFILE`, PostgreSQL's `lo_export`), create tables (`SELECT ... INTO`
 * in PostgreSQL and SQL Server), reach other servers (ClickHouse table
 * functions, `OPENROWSET`), run SQL hidden inside a string literal (dblink,
 * `query_to_xml`), or simply hang the conversation (`SLEEP`).
 *
 * The lists live in each dialect, since each engine has its own. This rule
 * applies to every statement, so a sloppy pattern causes false rejections
 * everywhere; each one matches a function call or a fixed phrase, not a bare
 * word that could be a column name.
 */
export class ForbiddenPatternRule implements ValidationRule {
  public readonly name = "forbidden-pattern";

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    for (const forbidden of inspection.dialect.forbiddenPatterns) {
      const match = forbidden.pattern.exec(inspection.skeleton);
      if (match) {
        return {
          valid: false,
          error: `Query contains "${match[0].trim()}", which is not allowed: ${forbidden.reason}.`,
        };
      }
    }
    return null;
  }
}
