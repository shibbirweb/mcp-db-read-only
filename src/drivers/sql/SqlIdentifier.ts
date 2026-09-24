/** A table name, optionally qualified by its schema or database. */
export interface QualifiedName {
  readonly schema: string | null;
  readonly name: string;
}

/**
 * Splits and quotes identifiers for interpolation into SQL.
 *
 * Names reach here already checked by SqlNamePolicy, whose allowlist cannot
 * contain a quote character. The quoting below still escapes one properly, by
 * doubling it, so safety does not rest on the allowlist alone: either
 * protection is enough on its own.
 */
export class SqlIdentifier {
  /** `schema.table` becomes both parts; `table` has no schema. */
  public static parse(value: string): QualifiedName {
    const dot = value.indexOf(".");
    if (dot === -1) {
      return { schema: null, name: value };
    }
    return { schema: value.slice(0, dot), name: value.slice(dot + 1) };
  }

  /** `name` with backticks, for MySQL, SQLite and ClickHouse. */
  public static backtick(part: string): string {
    return `\`${part.replace(/`/g, "``")}\``;
  }

  /** `"name"`, standard SQL, for PostgreSQL and SQLite. */
  public static doubleQuote(part: string): string {
    return `"${part.replace(/"/g, '""')}"`;
  }

  /** `[name]`, for SQL Server. */
  public static bracket(part: string): string {
    return `[${part.replace(/]/g, "]]")}]`;
  }

  /** Quote each part of a possibly qualified name with the given style. */
  public static quoteQualified(qualified: QualifiedName, quote: (part: string) => string): string {
    return qualified.schema
      ? `${quote(qualified.schema)}.${quote(qualified.name)}`
      : quote(qualified.name);
  }
}
