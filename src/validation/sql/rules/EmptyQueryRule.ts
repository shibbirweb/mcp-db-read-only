import type { QueryInspection, ValidationResult, ValidationRule } from "../../../types/validation.types.js";

/**
 * Rejects a statement with no content.
 *
 * Runs first so later rules can assume a non-empty skeleton. Catches the empty
 * string, whitespace, a bare semicolon, and a statement that was nothing but a
 * comment, since all of them arrive here as an empty skeleton.
 */
export class EmptyQueryRule implements ValidationRule {
  public readonly name = "empty-query";

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (inspection.skeleton.length === 0) {
      return { valid: false, error: "Empty query." };
    }
    return null;
  }
}
