import type { QueryInspection, ValidationResult, ValidationRule } from "../../../types/validation.types.js";

/**
 * Catches writes hidden behind an allowed first keyword.
 *
 * Three forms can do this:
 *
 * - `WITH c AS (...) DELETE FROM t` is a write whose first word is allowed,
 *   in MySQL 8, PostgreSQL, SQLite and ClickHouse.
 * - `EXPLAIN ANALYZE` genuinely executes the statement in MySQL and
 *   PostgreSQL, unlike plain EXPLAIN, which only plans it and is left alone.
 * - In T-SQL any statement can follow another with no separator at all, so on
 *   SQL Server every statement is scanned.
 *
 * **Elsewhere the scan is deliberately not applied to plain SELECT.** A
 * SELECT cannot become a write in those dialects, so scanning adds no safety,
 * and it actively breaks ordinary queries: `SELECT start FROM sessions`
 * contains START and `SELECT begin, end FROM ranges` contains BEGIN. The
 * MySQL-only predecessor tried a global scan first and failed on exactly these.
 *
 * The residual cost is that a column named exactly like a write keyword must
 * be quoted where the scan does run, which the message explains.
 */
export class SmuggledWriteRule implements ValidationRule {
  public readonly name = "smuggled-write";

  private static readonly ANALYZE = /\bANALYZE\b/i;

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (!this.needsBodyScan(inspection)) {
      return null;
    }

    const match = inspection.dialect.writeKeywords.exec(inspection.skeleton);
    if (!match) {
      return null;
    }

    return {
      valid: false,
      error: `This statement contains ${match[1].toUpperCase()}, which can modify data and is not allowed on a read-only connection. If ${match[1]} is a column or table name here, quote it as ${inspection.dialect.quoteExample}.`,
    };
  }

  private needsBodyScan(inspection: QueryInspection): boolean {
    const dialect = inspection.dialect;
    if (dialect.scanEveryStatement) {
      return true;
    }
    if (dialect.bodyScanKeywords.includes(inspection.leadingKeyword)) {
      return true;
    }
    return (
      dialect.scanExplainAnalyze &&
      inspection.leadingKeyword === "EXPLAIN" &&
      SmuggledWriteRule.ANALYZE.test(inspection.skeleton)
    );
  }
}
