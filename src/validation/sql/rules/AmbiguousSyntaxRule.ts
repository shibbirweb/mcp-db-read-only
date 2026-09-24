import type { QueryInspection, ValidationResult, ValidationRule } from "../../../types/validation.types.js";

/**
 * Rejects statements containing a construct the skeletonizer could not read
 * with certainty.
 *
 * Runs before every rule that inspects the skeleton, because those rules are
 * only as trustworthy as the skeleton, and an ambiguous construct means the
 * skeleton might not be what the server sees. The constructs involved (nested
 * comments, MySQL executable comments, backslashes in quoted identifiers) are
 * rare in hand-written reads, so the cost of refusing them is small and the
 * message says exactly what to remove.
 */
export class AmbiguousSyntaxRule implements ValidationRule {
  public readonly name = "ambiguous-syntax";

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (inspection.ambiguities.length === 0) {
      return null;
    }
    return {
      valid: false,
      error: `Query contains ${inspection.ambiguities.join(" and ")}, which ${inspection.dialect.label} could read differently from this validator. Rewrite the query without it.`,
    };
  }
}
