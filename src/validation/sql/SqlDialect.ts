export type SqlDialectName = "mysql" | "postgres" | "sqlite" | "mssql" | "clickhouse";

/**
 * How one quote character behaves in a dialect.
 *
 * - `none`: not a quote at all, so its contents stay visible to the rules.
 * - `plain`: only a doubled quote escapes it; a backslash is an ordinary
 *   character.
 * - `backslash`: a backslash escapes the next character, and a doubled quote
 *   works too.
 * - `reject-backslash`: treated as `plain`, but a backslash inside is reported
 *   as ambiguous, for dialects whose escaping rules here are not certain
 *   enough to bet the read-only guarantee on.
 */
export type QuoteMode = "none" | "plain" | "backslash" | "reject-backslash";

/**
 * The lexical facts the skeletonizer needs about a dialect.
 *
 * Every one of these matters for safety, not just for tidy parsing. If the
 * validator believes a string ends somewhere the server does not, the text in
 * between is hidden from one of them, and text hidden from the validator but
 * executed by the server is exactly how a write gets past a read-only check.
 */
export interface LexicalRules {
  readonly singleQuote: QuoteMode;
  readonly doubleQuote: QuoteMode;
  readonly backtick: QuoteMode;
  /** PostgreSQL `E'...'` strings, which take backslash escapes when plain strings do not. */
  readonly escapeStringPrefix: boolean;
  /** `none`, `doubled` (SQL Server: `]]` escapes) or `simple` (SQLite: ends at the first `]`). */
  readonly brackets: "none" | "doubled" | "simple";
  /** `$tag$ ... $tag$` quoting: PostgreSQL dollar quotes, ClickHouse heredocs. */
  readonly dollarQuotes: boolean;
  readonly hashComments: boolean;
  /** MySQL only treats `--` as a comment when whitespace follows it. */
  readonly dashCommentNeedsSpace: boolean;
  /** MySQL executes the contents of `/*! ... *\/`, so such a comment is not a comment. */
  readonly executableComments: boolean;
}

/** A pattern forbidden anywhere in a statement, with the reason given to the caller. */
export interface ForbiddenPattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Everything that differs between SQL engines as far as read-only validation
 * is concerned.
 *
 * Data rather than subclasses, because the rules themselves are identical in
 * every dialect: skeletonize, require one statement, check the first keyword,
 * look for smuggled writes, look for dangerous functions. Only the word lists
 * and the lexing change, and a table of those is easier to review than five
 * classes overriding each other.
 */
export interface SqlDialect {
  readonly name: SqlDialectName;
  readonly label: string;
  readonly lexical: LexicalRules;
  readonly allowedLeadingKeywords: readonly string[];
  /** Leading keywords whose statements may still contain a write, such as WITH. */
  readonly bodyScanKeywords: readonly string[];
  /** EXPLAIN ANALYZE executes its statement in MySQL and PostgreSQL. */
  readonly scanExplainAnalyze: boolean;
  /**
   * T-SQL needs no separator between statements, so `SELECT 1 DROP TABLE t` is
   * two statements. For SQL Server every statement is scanned for write
   * keywords, and a column named like one has to be bracketed.
   */
  readonly scanEveryStatement: boolean;
  readonly writeKeywords: RegExp;
  readonly forbiddenPatterns: readonly ForbiddenPattern[];
  /** How to quote an identifier, for error messages. */
  readonly quoteExample: string;
}

/** The five SQL dialects this server speaks. */
export class SqlDialects {
  private static readonly MYSQL: SqlDialect = {
    name: "mysql",
    label: "MySQL",
    lexical: {
      singleQuote: "backslash",
      doubleQuote: "backslash",
      backtick: "plain",
      escapeStringPrefix: false,
      brackets: "none",
      dollarQuotes: false,
      hashComments: true,
      dashCommentNeedsSpace: true,
      executableComments: true,
    },
    allowedLeadingKeywords: ["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN"],
    bodyScanKeywords: ["WITH"],
    scanExplainAnalyze: true,
    scanEveryStatement: false,
    // MySQL 8 allows a CTE to prefix UPDATE and DELETE, and EXPLAIN ANALYZE
    // runs what it explains. Nothing else can follow those two openings.
    writeKeywords:
      /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|RENAME|CALL|LOAD|HANDLER|LOCK|UNLOCK|INSTALL|UNINSTALL|FLUSH|SHUTDOWN|KILL)\b/i,
    forbiddenPatterns: [
      { pattern: /INTO\s+OUTFILE/i, reason: "INTO OUTFILE writes a file on the database server" },
      { pattern: /INTO\s+DUMPFILE/i, reason: "INTO DUMPFILE writes a file on the database server" },
      { pattern: /LOAD\s+DATA/i, reason: "LOAD DATA reads files into a table" },
      { pattern: /\bBENCHMARK\s*\(/i, reason: "BENCHMARK() can hang the conversation" },
      { pattern: /\bSLEEP\s*\(/i, reason: "SLEEP() can hang the conversation" },
    ],
    quoteExample: "`name`",
  };

  private static readonly POSTGRES: SqlDialect = {
    name: "postgres",
    label: "PostgreSQL",
    lexical: {
      // Plain strings take no backslash escapes, which is only true with
      // standard_conforming_strings on. The driver sets it on every
      // transaction so this is a fact rather than an assumption.
      singleQuote: "plain",
      doubleQuote: "plain",
      backtick: "none",
      escapeStringPrefix: true,
      brackets: "none",
      dollarQuotes: true,
      hashComments: false,
      dashCommentNeedsSpace: false,
      executableComments: false,
    },
    allowedLeadingKeywords: ["SELECT", "WITH", "SHOW", "EXPLAIN", "VALUES", "TABLE"],
    bodyScanKeywords: ["WITH"],
    scanExplainAnalyze: true,
    scanEveryStatement: false,
    // What may follow WITH (data-modifying CTEs) or EXPLAIN ANALYZE, and no
    // more: a longer list would reject ordinary queries over columns with
    // names like "comment" for no gain in safety.
    writeKeywords:
      /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|EXECUTE|DECLARE|REFRESH)\b/i,
    forbiddenPatterns: [
      { pattern: /\bINTO\b/i, reason: "SELECT ... INTO creates a table" },
      {
        pattern: /\b(set_config|pg_reload_conf|pg_rotate_logfile|pg_promote|pg_switch_wal|pg_create_restore_point|pg_logical_emit_message|pg_notify)\s*\(/i,
        reason: "that function changes server or session state",
      },
      {
        pattern: /\b(pg_terminate_backend|pg_cancel_backend)\s*\(/i,
        reason: "that function stops other sessions",
      },
      {
        // lo_export writes a file on the server, which a read-only
        // transaction does not prevent.
        pattern: /\b(lo_import|lo_export|pg_file_write|pg_read_file|pg_read_binary_file|pg_ls_dir)\s*\(/i,
        reason: "that function reaches the server's filesystem",
      },
      {
        // Each of these runs SQL passed as a string. The string is a literal,
        // so it is invisible to every rule here, and dblink runs it on a
        // separate connection that the read-only transaction does not cover.
        pattern: /\b(dblink\w*|query_to_xml\w*|cursor_to_xml\w*|ts_stat|crosstab\w*)\s*\(/i,
        reason: "that function runs SQL supplied as a string",
      },
      { pattern: /\bpg_sleep\w*\s*\(/i, reason: "pg_sleep() can hang the conversation" },
      { pattern: /\bpg_advisory\w*\s*\(/i, reason: "advisory locks outlive the query" },
    ],
    quoteExample: '"name"',
  };

  private static readonly SQLITE: SqlDialect = {
    name: "sqlite",
    label: "SQLite",
    lexical: {
      singleQuote: "plain",
      doubleQuote: "plain",
      backtick: "plain",
      escapeStringPrefix: false,
      brackets: "simple",
      dollarQuotes: false,
      hashComments: false,
      dashCommentNeedsSpace: false,
      executableComments: false,
    },
    allowedLeadingKeywords: ["SELECT", "WITH", "EXPLAIN", "VALUES"],
    bodyScanKeywords: ["WITH"],
    scanExplainAnalyze: false,
    scanEveryStatement: false,
    writeKeywords: /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i,
    forbiddenPatterns: [
      {
        pattern: /\b(load_extension|writefile|readfile|edit|fts3_tokenizer)\s*\(/i,
        reason: "that function reaches outside the database file",
      },
    ],
    quoteExample: '"name"',
  };

  private static readonly MSSQL: SqlDialect = {
    name: "mssql",
    label: "SQL Server",
    lexical: {
      singleQuote: "plain",
      doubleQuote: "plain",
      backtick: "none",
      escapeStringPrefix: false,
      brackets: "doubled",
      dollarQuotes: false,
      hashComments: false,
      dashCommentNeedsSpace: false,
      executableComments: false,
    },
    allowedLeadingKeywords: ["SELECT", "WITH"],
    bodyScanKeywords: [],
    scanExplainAnalyze: false,
    scanEveryStatement: true,
    // Every keyword that can start a statement with a side effect. OPEN,
    // CLOSE, FETCH, DECLARE and similar are left out deliberately: they are
    // harmless alone and common as column names in real schemas.
    writeKeywords:
      /\b(INSERT|UPDATE|DELETE|MERGE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|DENY|EXEC|EXECUTE|DBCC|BACKUP|RESTORE|SHUTDOWN|KILL|BULK|WAITFOR|RECONFIGURE|CHECKPOINT|SET|BEGIN|COMMIT|ROLLBACK|SAVE|USE|UPDATETEXT|WRITETEXT|SETUSER|ENABLE|DISABLE|SEND|RECEIVE)\b/i,
    forbiddenPatterns: [
      { pattern: /\bINTO\b/i, reason: "SELECT ... INTO creates a table" },
      {
        pattern: /\b(OPENROWSET|OPENDATASOURCE|OPENQUERY)\b/i,
        reason: "that function reaches another server and can run statements there",
      },
    ],
    quoteExample: "[name]",
  };

  private static readonly CLICKHOUSE: SqlDialect = {
    name: "clickhouse",
    label: "ClickHouse",
    lexical: {
      singleQuote: "backslash",
      // Identifier escaping is the one ClickHouse rule not pinned down well
      // enough to rely on, so a backslash inside an identifier is refused.
      doubleQuote: "reject-backslash",
      backtick: "reject-backslash",
      escapeStringPrefix: false,
      brackets: "none",
      dollarQuotes: true,
      hashComments: true,
      dashCommentNeedsSpace: false,
      executableComments: false,
    },
    allowedLeadingKeywords: ["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "EXISTS"],
    bodyScanKeywords: ["WITH"],
    scanExplainAnalyze: false,
    scanEveryStatement: false,
    writeKeywords:
      /\b(INSERT|ALTER|DROP|CREATE|TRUNCATE|RENAME|OPTIMIZE|ATTACH|DETACH|SYSTEM|KILL|DELETE|UPDATE|EXCHANGE|GRANT|REVOKE|SET|BACKUP|RESTORE)\b/i,
    forbiddenPatterns: [
      { pattern: /INTO\s+OUTFILE/i, reason: "INTO OUTFILE writes a file" },
      {
        // Table functions that fetch from outside the server: files on its
        // disk, URLs, object stores, other databases, arbitrary executables.
        // Reading through them turns a read-only analytics account into a
        // way to reach anything the server can reach.
        pattern:
          /\b(file|url|urlCluster|s3|s3Cluster|gcs|hdfs|hdfsCluster|azureBlobStorage|azureBlobStorageCluster|remote|remoteSecure|mysql|postgresql|mongodb|redis|sqlite|jdbc|odbc|executable|iceberg\w*|deltaLake\w*|hudi\w*)\s*\(/i,
        reason: "that table function reaches outside the ClickHouse server",
      },
      { pattern: /\b(sleep|sleepEachRow)\s*\(/i, reason: "sleep() can hang the conversation" },
    ],
    quoteExample: "`name`",
  };

  private static readonly BY_NAME: ReadonlyMap<SqlDialectName, SqlDialect> = new Map([
    ["mysql", SqlDialects.MYSQL],
    ["postgres", SqlDialects.POSTGRES],
    ["sqlite", SqlDialects.SQLITE],
    ["mssql", SqlDialects.MSSQL],
    ["clickhouse", SqlDialects.CLICKHOUSE],
  ]);

  public static get(name: SqlDialectName): SqlDialect {
    const dialect = SqlDialects.BY_NAME.get(name);
    if (!dialect) {
      throw new Error(`Unknown SQL dialect "${name}".`);
    }
    return dialect;
  }

  public static all(): SqlDialect[] {
    return Array.from(SqlDialects.BY_NAME.values());
  }
}
