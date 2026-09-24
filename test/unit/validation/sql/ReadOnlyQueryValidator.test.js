import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReadOnlyQueryValidator } from "../../../../dist/validation/sql/ReadOnlyQueryValidator.js";
import { SqlDialects } from "../../../../dist/validation/sql/SqlDialect.js";
import { LeadingKeywordRule } from "../../../../dist/validation/sql/rules/index.js";

const validators = Object.fromEntries(
  ["mysql", "postgres", "sqlite", "mssql", "clickhouse"].map((name) => [name, ReadOnlyQueryValidator.forDialect(name)])
);
const allows = (dialect, sql) => validators[dialect].validate(sql).valid;
const rejects = (dialect, sql) => !allows(dialect, sql);
const errorOf = (dialect, sql) => validators[dialect].validate(sql).error ?? "";
const ALL = Object.keys(validators);

describe("every dialect rejects the obvious writes", () => {
  const writes = [
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a = 1",
    "DELETE FROM t",
    "DROP TABLE t",
    "CREATE TABLE x (a int)",
    "ALTER TABLE t ADD c int",
    "TRUNCATE TABLE t",
    "GRANT SELECT ON t TO x",
    "",
    "   ",
    ";",
    "-- only a comment",
  ];
  for (const dialect of ALL) {
    for (const sql of writes) {
      test(`${dialect}: ${JSON.stringify(sql)}`, () => {
        assert.ok(rejects(dialect, sql));
      });
    }
  }
});

describe("every dialect rejects statement stacking", () => {
  for (const dialect of ALL) {
    test(`${dialect}: two statements`, () => {
      assert.match(errorOf(dialect, "SELECT 1; DELETE FROM t"), /Multiple statements/);
    });

    test(`${dialect}: a trailing semicolon alone is fine`, () => {
      assert.ok(allows(dialect, "SELECT 1;"));
    });
  }
});

describe("reads each dialect allows", () => {
  const reads = {
    mysql: ["SELECT * FROM t", "WITH c AS (SELECT 1) SELECT * FROM c", "SHOW TABLES", "DESCRIBE t", "EXPLAIN SELECT 1", "(SELECT 1) UNION (SELECT 2)"],
    postgres: ["SELECT * FROM t", "WITH c AS (SELECT 1) SELECT * FROM c", "SHOW search_path", "EXPLAIN SELECT 1", "VALUES (1), (2)", "TABLE t", "SELECT $$a;b$$"],
    sqlite: ["SELECT * FROM t", "WITH c AS (SELECT 1) SELECT * FROM c", "EXPLAIN QUERY PLAN SELECT 1", "VALUES (1)", "SELECT * FROM pragma_table_info('t')"],
    mssql: ["SELECT TOP (5) * FROM t", "WITH c AS (SELECT 1 AS a) SELECT * FROM c", "SELECT [update] FROM t", "SELECT open_price, close_price FROM prices"],
    clickhouse: ["SELECT * FROM t", "SHOW TABLES", "DESCRIBE TABLE t", "EXPLAIN SELECT 1", "EXISTS TABLE t", "SELECT count() FROM cluster('c', db, t)"],
  };
  for (const [dialect, list] of Object.entries(reads)) {
    for (const sql of list) {
      test(`${dialect}: ${sql}`, () => {
        assert.ok(allows(dialect, sql), errorOf(dialect, sql));
      });
    }
  }
});

describe("reads that would trip a careless global keyword scan", () => {
  // Ordinary column names that are keywords somewhere. A scan applied to
  // every SELECT would reject these, and gains nothing where a SELECT cannot
  // become a write.
  for (const dialect of ["mysql", "postgres", "sqlite", "clickhouse"]) {
    test(`${dialect}: columns named start, begin, end, comment and update`, () => {
      assert.ok(allows(dialect, "SELECT start, begin, end, comment, update FROM sessions"));
    });
  }
});

describe("writes smuggled past a safe first word", () => {
  test("mysql: a CTE prefixing a delete", () => {
    assert.ok(rejects("mysql", "WITH c AS (SELECT 1) DELETE FROM t"));
  });

  test("postgres: a data-modifying CTE", () => {
    assert.ok(rejects("postgres", "WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone"));
  });

  test("sqlite: a CTE prefixing an update", () => {
    assert.ok(rejects("sqlite", "WITH c AS (SELECT 1) UPDATE t SET a = 1"));
  });

  test("EXPLAIN ANALYZE runs its statement in mysql and postgres", () => {
    assert.ok(rejects("mysql", "EXPLAIN ANALYZE DELETE FROM t"));
    assert.ok(rejects("postgres", "EXPLAIN ANALYZE DELETE FROM t"));
    assert.ok(rejects("postgres", "EXPLAIN (ANALYZE) DELETE FROM t"));
  });

  test("plain EXPLAIN only plans, so it is allowed", () => {
    assert.ok(allows("postgres", "EXPLAIN SELECT * FROM t"));
  });

  // T-SQL needs no separator between statements, so every statement is
  // scanned there.
  test("mssql: a second statement with no semicolon", () => {
    assert.ok(rejects("mssql", "SELECT 1 DROP TABLE t"));
    assert.ok(rejects("mssql", "SELECT 1 EXEC xp_cmdshell 'dir'"));
    assert.ok(rejects("mssql", "SELECT 1 COMMIT"));
  });

  test("mssql: the message says how to quote a column named like a keyword", () => {
    assert.match(errorOf("mssql", "SELECT set FROM t"), /\[name\]/);
  });
});

describe("forbidden patterns inside otherwise valid reads", () => {
  const cases = [
    ["mysql", "SELECT * FROM t INTO OUTFILE '/tmp/x'"],
    ["mysql", "SELECT SLEEP(10)"],
    ["mysql", "SELECT BENCHMARK(1000000, MD5('x'))"],
    ["postgres", "SELECT * INTO copy FROM t"],
    ["postgres", "SELECT set_config('default_transaction_read_only', 'off', false)"],
    ["postgres", "SELECT lo_export(1, '/tmp/x')"],
    ["postgres", "SELECT pg_terminate_backend(123)"],
    ["postgres", "SELECT * FROM dblink('dbname=x', 'DELETE FROM t') AS r(a int)"],
    ["postgres", "SELECT query_to_xml('DELETE FROM t RETURNING *', true, false, '')"],
    ["postgres", "SELECT pg_sleep(60)"],
    ["sqlite", "SELECT load_extension('/tmp/evil')"],
    ["sqlite", "SELECT writefile('/tmp/x', 'y')"],
    ["mssql", "SELECT * INTO copy FROM t"],
    ["mssql", "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'DELETE FROM t')"],
    ["clickhouse", "SELECT * FROM url('http://169.254.169.254/latest/meta-data', CSV)"],
    ["clickhouse", "SELECT * FROM file('/etc/passwd', 'LineAsString')"],
    ["clickhouse", "SELECT * FROM s3('https://bucket/x', 'CSV')"],
    ["clickhouse", "SELECT * FROM remote('10.0.0.1', db, t)"],
    ["clickhouse", "SELECT * FROM executable('script.sh', 'CSV', 'x String')"],
    ["clickhouse", "SELECT sleep(3)"],
  ];
  for (const [dialect, sql] of cases) {
    test(`${dialect}: ${sql}`, () => {
      assert.match(errorOf(dialect, sql), /not allowed/);
    });
  }

  test("a forbidden name inside a string literal is only data", () => {
    assert.ok(allows("postgres", "SELECT 'set_config(' AS s"));
    assert.ok(allows("clickhouse", "SELECT 'url(' AS u"));
  });

  test("a column named url is not the url() table function", () => {
    assert.ok(allows("clickhouse", "SELECT url FROM visits"));
  });
});

describe("ambiguous syntax is refused rather than guessed", () => {
  test("a MySQL executable comment carrying INTO OUTFILE", () => {
    assert.match(
      errorOf("mysql", "SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */"),
      /executable comment/
    );
  });

  test("a nested comment that would hide a second statement", () => {
    for (const dialect of ALL) {
      assert.match(errorOf(dialect, "SELECT 1 /* /* */ ; DELETE FROM t; -- */"), /nested block comment/, dialect);
    }
  });
});

describe("literals and quoted identifiers are never read as SQL", () => {
  test("a write keyword in a string, in every dialect", () => {
    for (const dialect of ALL) {
      assert.ok(allows(dialect, "SELECT 'DELETE FROM t; DROP TABLE t' AS s"), dialect);
    }
  });

  test("postgres: the backslash trick that would fool a MySQL-style lexer", () => {
    // PostgreSQL ends the string at the second quote, so this is two
    // statements, and must be refused.
    assert.ok(rejects("postgres", "SELECT 'a\\'; DELETE FROM t; --'"));
  });
});

describe("error messages", () => {
  test("name the offending keyword and the dialect's allowed set", () => {
    const error = errorOf("sqlite", "PRAGMA writable_schema = 1");
    assert.match(error, /Got: PRAGMA/);
    assert.match(error, /SELECT, WITH, EXPLAIN and VALUES/);
    assert.match(error, /SQLite/);
  });
});

describe("the rule chain is composable", () => {
  const mysql = SqlDialects.get("mysql");

  test("a chain without the keyword rule lets a write through", () => {
    const permissive = new ReadOnlyQueryValidator(mysql, []);
    assert.ok(permissive.validate("DELETE FROM t").valid);
  });

  test("one rule alone does its one job", () => {
    const onlyKeyword = new ReadOnlyQueryValidator(mysql, [new LeadingKeywordRule()]);
    assert.ok(!onlyKeyword.validate("DELETE FROM t").valid);
    assert.ok(onlyKeyword.validate("SELECT 1; DELETE FROM t").valid, "stacking is another rule's job");
  });
});
