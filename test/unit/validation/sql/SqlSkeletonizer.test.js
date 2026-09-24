import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqlDialects } from "../../../../dist/validation/sql/SqlDialect.js";
import { SqlSkeletonizer } from "../../../../dist/validation/sql/SqlSkeletonizer.js";

const skeletonizer = new SqlSkeletonizer();
const skeleton = (dialect, sql) => skeletonizer.skeletonize(sql, SqlDialects.get(dialect).lexical);
const text = (dialect, sql) => skeleton(dialect, sql).text.replace(/\s+/g, " ").trim();

describe("literals are blanked in every dialect", () => {
  for (const dialect of ["mysql", "postgres", "sqlite", "mssql", "clickhouse"]) {
    test(`${dialect}: a semicolon inside a string is not a separator`, () => {
      assert.ok(!text(dialect, "SELECT 'a; DROP TABLE t'").includes(";"));
    });

    test(`${dialect}: a doubled quote stays inside the string`, () => {
      assert.equal(text(dialect, "SELECT 'it''s; fine' AS x"), "SELECT AS x");
    });

    test(`${dialect}: block comments are blanked`, () => {
      assert.equal(text(dialect, "SELECT /* ; DROP */ 1"), "SELECT 1");
    });
  }
});

describe("backslashes follow each dialect's rules", () => {
  // The dangerous case: if the validator treats \' as an escape where the
  // server does not, it thinks the string runs on and hides what follows.
  test("mysql: a backslash escapes the quote", () => {
    assert.equal(text("mysql", "SELECT 'a\\' ; x' AS y"), "SELECT AS y");
  });

  test("postgres: a backslash is an ordinary character in a plain string", () => {
    assert.equal(text("postgres", "SELECT 'a\\' ; DROP TABLE t; --'"), "SELECT ; DROP TABLE t;");
  });

  test("postgres: an E'' string does take backslash escapes", () => {
    assert.equal(text("postgres", "SELECT E'a\\' ; x' AS y"), "SELECT E AS y");
  });

  test("postgres: a column ending in e before a quote is not an E-string", () => {
    assert.equal(text("postgres", "SELECT name'a\\' ; x'"), "SELECT name ; x");
  });

  test("sqlite and mssql: backslash is ordinary", () => {
    assert.match(text("sqlite", "SELECT 'a\\' ; x"), /;/);
    assert.match(text("mssql", "SELECT 'a\\' ; x"), /;/);
  });
});

describe("dialect-specific quoting", () => {
  test("postgres: dollar-quoted strings hide their contents", () => {
    assert.equal(text("postgres", "SELECT $$ ; DROP TABLE t; $$ AS x"), "SELECT AS x");
    assert.equal(text("postgres", "SELECT $fn$ it's ; here $fn$ AS x"), "SELECT AS x");
  });

  // Without dollar-quote support the ' inside $$ would start a "string" that
  // swallows the real DROP after it.
  test("postgres: a quote inside a dollar string does not open a string", () => {
    assert.equal(text("postgres", "SELECT $$ ' $$; DROP TABLE t; --'"), "SELECT ; DROP TABLE t;");
  });

  test("postgres: $1 is a parameter, not a quote", () => {
    assert.equal(text("postgres", "SELECT $1, $2"), "SELECT $1, $2");
  });

  test("postgres: $ inside an identifier does not open a quote", () => {
    assert.equal(text("postgres", "SELECT price$usd$ FROM t"), "SELECT price$usd$ FROM t");
  });

  test("postgres: double quotes are identifiers and are blanked", () => {
    assert.equal(text("postgres", 'SELECT "delete" FROM t'), "SELECT FROM t");
  });

  test("mssql: brackets are identifiers, and ]] escapes", () => {
    assert.equal(text("mssql", "SELECT [a]]; b] FROM t"), "SELECT FROM t");
  });

  // The attack brackets defend against: without bracket support, the ' in
  // [a'b] opens a "string" that hides a real second statement.
  test("mssql: a quote inside brackets does not open a string", () => {
    assert.equal(text("mssql", "SELECT [a'b] DROP TABLE t --'"), "SELECT DROP TABLE t");
  });

  test("sqlite: brackets end at the first ]", () => {
    assert.equal(text("sqlite", "SELECT [a] FROM t"), "SELECT FROM t");
  });

  test("clickhouse: heredocs hide their contents", () => {
    assert.equal(text("clickhouse", "SELECT $h$ ; $h$ AS x"), "SELECT AS x");
  });

  test("backticks are identifiers where supported and ordinary elsewhere", () => {
    assert.equal(text("mysql", "SELECT `x;y` FROM t"), "SELECT FROM t");
    assert.match(text("postgres", "SELECT `x;y` FROM t"), /;/);
  });
});

describe("comments", () => {
  test("mysql: -- needs whitespace, so 1--2 is arithmetic", () => {
    assert.equal(text("mysql", "SELECT 1--2"), "SELECT 1--2");
    assert.equal(text("mysql", "SELECT 1 -- ; x"), "SELECT 1");
  });

  test("postgres: -- needs no whitespace", () => {
    assert.equal(text("postgres", "SELECT 1--; x"), "SELECT 1");
  });

  test("# is a comment in mysql and clickhouse only", () => {
    assert.equal(text("mysql", "SELECT 1 # ; x"), "SELECT 1");
    assert.equal(text("clickhouse", "SELECT 1 # ; x"), "SELECT 1");
    assert.match(text("postgres", "SELECT 1 # ; x"), /;/);
  });
});

describe("ambiguities are reported, not guessed", () => {
  test("a nested block comment, in every dialect", () => {
    for (const dialect of ["mysql", "postgres", "sqlite", "mssql", "clickhouse"]) {
      assert.deepEqual(skeleton(dialect, "SELECT /* a /* b */ 1").ambiguities, [SqlSkeletonizer.NESTED_COMMENT], dialect);
    }
  });

  test("a MySQL executable comment", () => {
    assert.deepEqual(skeleton("mysql", "SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */").ambiguities, [
      SqlSkeletonizer.EXECUTABLE_COMMENT,
    ]);
    assert.deepEqual(skeleton("mysql", "SELECT 1 /*M!100000 x */").ambiguities, [SqlSkeletonizer.EXECUTABLE_COMMENT]);
  });

  test("/*! is only special in MySQL", () => {
    assert.deepEqual(skeleton("postgres", "SELECT 1 /*! x */").ambiguities, []);
  });

  test("a backslash inside a ClickHouse quoted identifier", () => {
    assert.deepEqual(skeleton("clickhouse", 'SELECT "a\\" FROM t').ambiguities, [SqlSkeletonizer.IDENTIFIER_BACKSLASH]);
  });

  test("an ordinary statement has none", () => {
    assert.deepEqual(skeleton("postgres", "SELECT 'a', \"b\", $$c$$ FROM t -- d").ambiguities, []);
  });
});
