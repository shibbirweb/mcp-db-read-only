import type { QueryInspection, ValidationResult, ValidationRule } from "../../../types/validation.types.js";

/**
 * Requires the statement to begin with a keyword that reads rather than writes.
 *
 * The allowed set is per dialect, because the read statements differ: SHOW
 * exists in MySQL and ClickHouse but not SQLite, and SQL Server has neither
 * SHOW nor EXPLAIN. WITH is allowed everywhere, since rejecting CTEs is a real
 * loss on an analysis tool, and that is exactly why SmuggledWriteRule exists.
 */
export class LeadingKeywordRule implements ValidationRule {
  public readonly name = "leading-keyword";

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    const allowed = inspection.dialect.allowedLeadingKeywords;
    if (allowed.includes(inspection.leadingKeyword)) {
      return null;
    }

    // Naming the offending keyword matters: a model told precisely what was
    // wrong usually rewrites the query correctly without further prompting.
    return {
      valid: false,
      error: `Only ${this.list(allowed)} are allowed on ${inspection.dialect.label}. Got: ${inspection.leadingKeyword}`,
    };
  }

  private list(keywords: readonly string[]): string {
    if (keywords.length === 1) {
      return keywords[0];
    }
    return `${keywords.slice(0, -1).join(", ")} and ${keywords[keywords.length - 1]}`;
  }
}
