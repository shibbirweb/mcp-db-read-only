import type { ObjectListing } from "../types/driver.types.js";

/**
 * The `pattern` argument of list_tables: `*` for any run of characters, `?`
 * for one.
 *
 * Glob rather than SQL LIKE or regular expressions because it is the one
 * syntax that means the same thing on every engine here. Redis SCAN MATCH and
 * Elasticsearch index patterns take it natively; the SQL and MongoDB drivers
 * apply it with this class after listing.
 */
export class GlobPattern {
  private readonly expression: RegExp | null;

  constructor(pattern: string | undefined) {
    this.expression = pattern ? GlobPattern.compile(pattern) : null;
  }

  public matches(name: string): boolean {
    return this.expression ? this.expression.test(name) : true;
  }

  /** Filter, then cap, reporting whether the cap cut anything off. */
  public apply(names: string[], limit: number): ObjectListing {
    const matching = names.filter((name) => this.matches(name));
    return {
      names: matching.slice(0, limit),
      truncated: matching.length > limit,
    };
  }

  /** Case-insensitive, since table name case is rarely what someone means to filter on. */
  private static compile(pattern: string): RegExp {
    const source = Array.from(pattern)
      .map((char) => {
        if (char === "*") {
          return ".*";
        }
        if (char === "?") {
          return ".";
        }
        return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return new RegExp(`^${source}$`, "i");
  }
}
