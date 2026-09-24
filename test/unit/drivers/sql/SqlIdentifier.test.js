import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqlIdentifier } from "../../../../dist/drivers/sql/SqlIdentifier.js";

describe("parsing", () => {
  test("a bare name has no schema", () => {
    assert.deepEqual(SqlIdentifier.parse("users"), { schema: null, name: "users" });
  });

  test("a qualified name splits at the first dot", () => {
    assert.deepEqual(SqlIdentifier.parse("sales.orders"), { schema: "sales", name: "orders" });
  });
});

describe("quoting escapes, independently of the name policy", () => {
  test("backticks are doubled", () => {
    assert.equal(SqlIdentifier.backtick("a`b"), "`a``b`");
  });

  test("double quotes are doubled", () => {
    assert.equal(SqlIdentifier.doubleQuote('a"b'), '"a""b"');
  });

  test("closing brackets are doubled", () => {
    assert.equal(SqlIdentifier.bracket("a]b"), "[a]]b]");
  });

  test("each part of a qualified name is quoted separately", () => {
    assert.equal(
      SqlIdentifier.quoteQualified(SqlIdentifier.parse("s.t"), SqlIdentifier.doubleQuote),
      '"s"."t"'
    );
  });
});
