import type { SqlDialect } from "../validation/sql/SqlDialect.js";

/** Outcome of a validation check. `error` is present only when invalid. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * A SQL statement reduced to the parts a rule may safely reason about.
 *
 * `skeleton` has every string literal, quoted identifier and comment replaced
 * by whitespace, so a rule inspecting it can never mistake user data for SQL.
 *
 * `ambiguities` lists constructs the lexer could not be certain it read the
 * same way the server will, such as a nested block comment. The lexer reports
 * them rather than guessing, because a guess that differs from the server's
 * reading is precisely how a hidden statement gets through.
 */
export interface QueryInspection {
  readonly raw: string;
  readonly skeleton: string;
  readonly leadingKeyword: string;
  readonly ambiguities: readonly string[];
  readonly dialect: SqlDialect;
}

/**
 * One check in the read-only chain.
 *
 * Returning `null` means "this rule has no objection", which lets the validator
 * run the chain without each rule knowing about the others.
 */
export interface ValidationRule {
  readonly name: string;
  evaluate(inspection: QueryInspection): ValidationResult | null;
}
