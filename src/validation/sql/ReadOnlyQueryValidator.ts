import { SqlDialects } from "./SqlDialect.js";
import type { SqlDialect, SqlDialectName } from "./SqlDialect.js";
import { SqlSkeletonizer } from "./SqlSkeletonizer.js";
import {
  AmbiguousSyntaxRule,
  EmptyQueryRule,
  ForbiddenPatternRule,
  LeadingKeywordRule,
  SingleStatementRule,
  SmuggledWriteRule,
} from "./rules/index.js";
import type { QueryInspection, ValidationResult, ValidationRule } from "../../types/validation.types.js";

/**
 * Decides whether a SQL statement may run, by walking a chain of rules.
 *
 * Chain of Responsibility: each rule inspects the statement and either objects
 * or passes. The validator knows nothing about what any rule checks, and a
 * rule knows nothing about the others, so adding or reordering a check is a
 * local change.
 *
 * One validator per dialect. The rules are shared; the dialect decides how the
 * statement is lexed and which word lists the rules consult.
 *
 * This is layer one of two. Every SQL driver also enforces read-only on the
 * server side, independently, so a bug here alone cannot become a write.
 */
export class ReadOnlyQueryValidator {
  /**
   * Order matters. Empty first so later rules can assume content; ambiguity
   * before anything that trusts the skeleton; leading keyword before the
   * smuggled-write scan, which is conditional on it.
   */
  public static defaultRules(): ValidationRule[] {
    return [
      new EmptyQueryRule(),
      new AmbiguousSyntaxRule(),
      new SingleStatementRule(),
      new LeadingKeywordRule(),
      new SmuggledWriteRule(),
      new ForbiddenPatternRule(),
    ];
  }

  public static forDialect(name: SqlDialectName): ReadOnlyQueryValidator {
    return new ReadOnlyQueryValidator(SqlDialects.get(name));
  }

  constructor(
    public readonly dialect: SqlDialect,
    private readonly rules: ValidationRule[] = ReadOnlyQueryValidator.defaultRules(),
    private readonly skeletonizer: SqlSkeletonizer = new SqlSkeletonizer()
  ) {}

  public validate(sql: string): ValidationResult {
    const inspection = this.inspect(sql);

    for (const rule of this.rules) {
      const objection = rule.evaluate(inspection);
      if (objection) {
        return objection;
      }
    }

    return { valid: true };
  }

  /**
   * Builds the view of the statement every rule shares.
   *
   * The original SQL is what eventually reaches the server; the skeleton is
   * only ever used to decide whether it may.
   */
  private inspect(sql: string): QueryInspection {
    const skeleton = this.skeletonizer.skeletonize(sql, this.dialect.lexical);
    const text = skeleton.text
      .trim()
      // A single trailing semicolon is idiomatic when pasting a query and is
      // not statement stacking.
      .replace(/;+\s*$/, "")
      .trim();

    return {
      raw: sql,
      skeleton: text,
      leadingKeyword: this.leadingKeyword(text),
      ambiguities: skeleton.ambiguities,
      dialect: this.dialect,
    };
  }

  /** Leading parentheses are stripped so `(SELECT 1) UNION (SELECT 2)` works. */
  private leadingKeyword(skeleton: string): string {
    const firstWord = skeleton.replace(/^[\s(]+/, "").split(/[\s(]+/)[0] ?? "";
    return firstWord.toUpperCase();
  }
}
