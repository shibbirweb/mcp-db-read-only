import type { ValidationResult } from "../../types/validation.types.js";

/**
 * What a valid database and object name look like on one engine.
 *
 * One policy per engine family, because the rules are unrelated: a MySQL
 * table name is interpolated into SQL and must be conservative, a MongoDB
 * collection name goes through the driver API and may contain dots and
 * hyphens, a Redis key is any string at all, and an Elasticsearch index name
 * becomes part of a URL path.
 */
export interface NamePolicy {
  validateDatabase(value: string): ValidationResult;
  /** A table, collection, key or index, as named by the `table` argument. */
  validateObject(value: string, label: string): ValidationResult;
  /** The glob given to list_tables. */
  validatePattern(value: string): ValidationResult;
}

function invalid(error: string): ValidationResult {
  return { valid: false, error };
}

const VALID: ValidationResult = { valid: true };

/**
 * Where the pattern is only ever matched in process or sent as a command
 * argument, any glob is safe; the length cap just keeps a runaway argument
 * from becoming a runaway regular expression.
 */
function validateLocalPattern(value: string): ValidationResult {
  if (value.length > 256) {
    return invalid("The pattern is too long.");
  }
  return VALID;
}

/**
 * SQL engines: an allowlist, optionally schema-qualified.
 *
 * Several SQL engines cannot parameterise an identifier, so a table name can
 * end up interpolated into the statement. The allowlist is what makes that
 * safe: nothing matching it can close a quote. Drivers additionally escape
 * every identifier they quote, so the two protections are independent.
 *
 * Hyphens are allowed where the MySQL-only predecessor refused them, because
 * every identifier is now quoted and escaped, and database names such as
 * `my-app` are common on PostgreSQL and SQL Server. For anything needing
 * spaces or other characters, run_query with a hand-quoted statement remains
 * the escape hatch, and it goes through the full SQL validator instead.
 */
export class SqlNamePolicy implements NamePolicy {
  private static readonly PART = "[A-Za-z0-9_$-]+";
  private static readonly DATABASE = new RegExp(`^${SqlNamePolicy.PART}$`);
  private static readonly OBJECT = new RegExp(`^${SqlNamePolicy.PART}(\\.${SqlNamePolicy.PART})?$`);

  public validateDatabase(value: string): ValidationResult {
    if (!value || !SqlNamePolicy.DATABASE.test(value)) {
      return invalid(
        `Invalid database name: "${value}". Only letters, digits, underscore, hyphen and $ are allowed.`
      );
    }
    return VALID;
  }

  public validateObject(value: string, label: string): ValidationResult {
    if (!value || !SqlNamePolicy.OBJECT.test(value)) {
      return invalid(
        `Invalid ${label}: "${value}". Use letters, digits, underscore, hyphen and $, optionally qualified as schema.table.`
      );
    }
    return VALID;
  }

  public validatePattern(value: string): ValidationResult {
    return validateLocalPattern(value);
  }
}

/**
 * MongoDB: the server's own naming rules, since names never reach a query
 * string. Collection names may contain dots (`system.profile`) and hyphens.
 */
export class MongoNamePolicy implements NamePolicy {
  private static readonly DATABASE = /^[^/\\. "$*<>:|?\0]{1,63}$/;

  public validateDatabase(value: string): ValidationResult {
    if (!MongoNamePolicy.DATABASE.test(value)) {
      return invalid(
        `Invalid database name: "${value}". MongoDB database names cannot contain / \\ . space " $ * < > : | ?`
      );
    }
    return VALID;
  }

  public validateObject(value: string, label: string): ValidationResult {
    if (!value || value.length > 255 || value.includes("$") || value.includes("\0")) {
      return invalid(`Invalid ${label}: "${value}". Collection names cannot be empty or contain $.`);
    }
    return VALID;
  }

  public validatePattern(value: string): ValidationResult {
    return validateLocalPattern(value);
  }
}

/**
 * Redis: databases are numbered, and a key is any byte string. Keys are sent
 * as command arguments, never interpolated, so there is nothing to escape.
 */
export class RedisNamePolicy implements NamePolicy {
  public validateDatabase(value: string): ValidationResult {
    if (!/^\d{1,5}$/.test(value)) {
      return invalid(`Invalid database: "${value}". Redis databases are numbered, e.g. 0 or 3.`);
    }
    return VALID;
  }

  public validateObject(value: string, label: string): ValidationResult {
    if (!value) {
      return invalid(`Invalid ${label}: a key cannot be empty.`);
    }
    return VALID;
  }

  public validatePattern(value: string): ValidationResult {
    return validateLocalPattern(value);
  }
}

/**
 * Elasticsearch and OpenSearch: an index name, pattern or comma list, which
 * becomes a URL path segment.
 *
 * Percent-encoding the segment is not enough on its own. A name of `.` or one
 * containing `..` is normalised away by the URL parser, repointing the request
 * at a different endpoint, and a leading `_` names an API rather than an
 * index. Those are refused before a path is ever built.
 */
export class ElasticNamePolicy implements NamePolicy {
  private static readonly OBJECT = /^[A-Za-z0-9_.*,+:\-]+$/;

  public validateDatabase(): ValidationResult {
    return invalid("Elasticsearch has no databases. Name an index or pattern with the table argument.");
  }

  public validateObject(value: string, label: string): ValidationResult {
    const parts = value.split(",");
    const bad =
      !value ||
      !ElasticNamePolicy.OBJECT.test(value) ||
      value.includes("..") ||
      parts.some((part) => part === "" || part === "." || part.startsWith("_"));
    if (bad) {
      return invalid(
        `Invalid ${label}: "${value}". Use an index name, a pattern such as logs-*, or a comma-separated list; names cannot start with _ or contain "..".`
      );
    }
    return VALID;
  }

  /** The pattern becomes a path segment here, so it meets the same rules as a name. */
  public validatePattern(value: string): ValidationResult {
    return this.validateObject(value, "pattern");
  }
}
