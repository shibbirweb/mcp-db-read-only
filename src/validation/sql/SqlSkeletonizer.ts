import type { LexicalRules, QuoteMode } from "./SqlDialect.js";

/** A statement with its literals and comments blanked, plus anything the lexer could not be sure of. */
export interface Skeleton {
  readonly text: string;
  readonly ambiguities: string[];
}

/**
 * Reduces a statement to its syntactic skeleton by blanking every string
 * literal, quoted identifier and comment, following one dialect's rules.
 *
 * Its own class because every rule depends on it and none should re-implement
 * it. It is the foundation of the whole read-only guard: rules inspecting the
 * skeleton can never mistake user data for SQL.
 *
 * Written as a character scanner rather than regular expressions because these
 * constructs nest and escape in ways regular expressions cannot express
 * correctly. A regex version was tried in the MySQL-only predecessor and
 * rejected; its failure mode was false rejections of ordinary queries.
 *
 * Where a construct could be read two ways, the scanner reports it instead of
 * picking one. A nested block comment is the example: PostgreSQL and SQL
 * Server nest them, MySQL and SQLite do not, and a validator that guesses
 * wrong hides whatever follows the inner `*\/` from itself while the server
 * runs it. Refusing the construct removes the question entirely.
 */
export class SqlSkeletonizer {
  public static readonly NESTED_COMMENT = "a nested block comment";
  public static readonly EXECUTABLE_COMMENT = "a MySQL executable comment (/*! ... */)";
  public static readonly IDENTIFIER_BACKSLASH = "a backslash inside a quoted identifier";

  /** Characters that can continue an identifier, which decides where `$tag$` may begin. */
  private static readonly IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-￿]/;

  /** A dollar-quote delimiter: `$$` or `$tag$`, where a tag cannot start with a digit. */
  private static readonly DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;

  public skeletonize(sql: string, rules: LexicalRules): Skeleton {
    const ambiguities = new Set<string>();
    let out = "";
    let index = 0;

    while (index < sql.length) {
      const char = sql[index];

      const quoteMode = this.quoteModeAt(sql, index, rules);
      if (quoteMode !== "none") {
        index = this.skipQuoted(sql, index, quoteMode, ambiguities);
        // Blanked to a single space, so a quoted column named after a keyword
        // is invisible to the keyword rules, and `'a'OR` still separates.
        out += " ";
        continue;
      }

      if (char === "[" && rules.brackets !== "none") {
        index = this.skipBracketed(sql, index, rules.brackets);
        out += " ";
        continue;
      }

      if (char === "$" && rules.dollarQuotes) {
        const delimiter = this.dollarDelimiterAt(sql, index);
        if (delimiter) {
          index = this.skipDollarQuoted(sql, index, delimiter);
          out += " ";
          continue;
        }
      }

      if (this.startsLineComment(sql, index, rules)) {
        index = this.skipToLineEnd(sql, index);
        continue;
      }

      if (char === "/" && sql[index + 1] === "*") {
        if (rules.executableComments && this.isExecutableComment(sql, index)) {
          ambiguities.add(SqlSkeletonizer.EXECUTABLE_COMMENT);
        }
        index = this.skipBlockComment(sql, index, ambiguities);
        out += " ";
        continue;
      }

      out += char;
      index += 1;
    }

    return { text: out, ambiguities: Array.from(ambiguities) };
  }

  /** Which quoting applies to the character at `index`, if it opens one. */
  private quoteModeAt(sql: string, index: number, rules: LexicalRules): QuoteMode {
    const char = sql[index];
    if (char === "'") {
      return rules.escapeStringPrefix && this.isEscapeStringPrefix(sql, index)
        ? "backslash"
        : rules.singleQuote;
    }
    if (char === '"') {
      return rules.doubleQuote;
    }
    if (char === "`") {
      return rules.backtick;
    }
    return "none";
  }

  /**
   * `E'...'` in PostgreSQL, where the `E` stands alone rather than ending an
   * identifier: `E'\''` is an escape string, `name'...'` is not.
   */
  private isEscapeStringPrefix(sql: string, quoteIndex: number): boolean {
    const prefix = sql[quoteIndex - 1];
    if (prefix !== "E" && prefix !== "e") {
      return false;
    }
    const before = sql[quoteIndex - 2];
    return before === undefined || !SqlSkeletonizer.IDENTIFIER_CHAR.test(before);
  }

  private skipQuoted(sql: string, start: number, mode: QuoteMode, ambiguities: Set<string>): number {
    const quote = sql[start];
    let index = start + 1;

    while (index < sql.length) {
      const char = sql[index];
      if (char === "\\") {
        if (mode === "backslash") {
          index += 2;
          continue;
        }
        if (mode === "reject-backslash") {
          ambiguities.add(SqlSkeletonizer.IDENTIFIER_BACKSLASH);
        }
      }
      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        return index + 1;
      }
      index += 1;
    }

    // Unterminated: blank to the end. The server rejects it as a syntax
    // error, so treating the rest as literal cannot let anything through.
    return index;
  }

  private skipBracketed(sql: string, start: number, style: "doubled" | "simple"): number {
    let index = start + 1;
    while (index < sql.length) {
      if (sql[index] === "]") {
        if (style === "doubled" && sql[index + 1] === "]") {
          index += 2;
          continue;
        }
        return index + 1;
      }
      index += 1;
    }
    return index;
  }

  /**
   * A `$` preceded by an identifier character is part of that identifier
   * (`price$usd`), and `$1` is a parameter, so neither opens a quote.
   */
  private dollarDelimiterAt(sql: string, index: number): string | null {
    const before = sql[index - 1];
    if (before !== undefined && SqlSkeletonizer.IDENTIFIER_CHAR.test(before)) {
      return null;
    }
    SqlSkeletonizer.DOLLAR_TAG.lastIndex = index;
    const match = SqlSkeletonizer.DOLLAR_TAG.exec(sql);
    return match ? match[0] : null;
  }

  private skipDollarQuoted(sql: string, start: number, delimiter: string): number {
    const end = sql.indexOf(delimiter, start + delimiter.length);
    return end === -1 ? sql.length : end + delimiter.length;
  }

  private startsLineComment(sql: string, index: number, rules: LexicalRules): boolean {
    if (sql[index] === "#" && rules.hashComments) {
      return true;
    }
    if (sql[index] !== "-" || sql[index + 1] !== "-") {
      return false;
    }
    if (!rules.dashCommentNeedsSpace) {
      return true;
    }
    // MySQL requires whitespace after `--`, so `SELECT 1--2` stays an
    // arithmetic expression rather than becoming a comment.
    const after = sql[index + 2];
    return after === undefined || /\s/.test(after);
  }

  private skipToLineEnd(sql: string, start: number): number {
    let index = start;
    while (index < sql.length && sql[index] !== "\n") {
      index += 1;
    }
    return index;
  }

  /** `/*!` and MariaDB's `/*M!`, both of which MySQL executes. */
  private isExecutableComment(sql: string, start: number): boolean {
    return sql[start + 2] === "!" || (sql[start + 2] === "M" && sql[start + 3] === "!");
  }

  private skipBlockComment(sql: string, start: number, ambiguities: Set<string>): number {
    let index = start + 2;
    while (index < sql.length) {
      if (sql[index] === "*" && sql[index + 1] === "/") {
        return index + 2;
      }
      if (sql[index] === "/" && sql[index + 1] === "*") {
        ambiguities.add(SqlSkeletonizer.NESTED_COMMENT);
      }
      index += 1;
    }
    return index;
  }
}
