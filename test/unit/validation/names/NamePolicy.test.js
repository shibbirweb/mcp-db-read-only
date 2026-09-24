import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NamePolicyRegistry } from "../../../../dist/validation/names/NamePolicyRegistry.js";

const policies = new NamePolicyRegistry();
const ok = (engine, method, value) => policies.for(engine)[method](value, "name").valid;

describe("SQL names", () => {
  test("plain, qualified and hyphenated names pass", () => {
    for (const value of ["users", "public.users", "my-app", "order_items$2"]) {
      assert.ok(ok("postgres", "validateObject", value), value);
    }
  });

  test("anything that could close a quote is refused", () => {
    for (const value of ["users`", 'users"', "users]", "users; DROP", "a.b.c", "", "users name"]) {
      assert.ok(!ok("mysql", "validateObject", value), value);
    }
  });

  test("a database name cannot be qualified", () => {
    assert.ok(!ok("mysql", "validateDatabase", "a.b"));
  });
});

describe("MongoDB names", () => {
  test("collections may contain dots and hyphens", () => {
    assert.ok(ok("mongodb", "validateObject", "system.profile"));
    assert.ok(ok("mongodb", "validateObject", "user-events"));
  });

  test("collections cannot contain $", () => {
    assert.ok(!ok("mongodb", "validateObject", "a$b"));
  });

  test("database names follow the server's restrictions", () => {
    assert.ok(ok("mongodb", "validateDatabase", "my-app"));
    assert.ok(!ok("mongodb", "validateDatabase", "a.b"));
    assert.ok(!ok("mongodb", "validateDatabase", "a/b"));
  });
});

describe("Redis names", () => {
  test("databases are numbers", () => {
    assert.ok(ok("redis", "validateDatabase", "3"));
    assert.ok(!ok("redis", "validateDatabase", "cache"));
  });

  test("any non-empty key is valid, since keys are never interpolated", () => {
    assert.ok(ok("redis", "validateObject", "user:42 {weird} 'key'"));
    assert.ok(!ok("redis", "validateObject", ""));
  });
});

describe("Elasticsearch names", () => {
  test("names, patterns and comma lists pass", () => {
    for (const value of ["logs", "logs-*", "logs-2026.09.24", "a,b", "remote:logs"]) {
      assert.ok(ok("elasticsearch", "validateObject", value), value);
    }
  });

  test("names that would repoint the URL at an API are refused", () => {
    for (const value of [".", "..", "logs/../_security", "_all", "a,_security", "a/b", "a?b"]) {
      assert.ok(!ok("elasticsearch", "validateObject", value), value);
    }
  });

  test("there are no databases", () => {
    assert.ok(!ok("elasticsearch", "validateDatabase", "x"));
  });

  test("the list pattern meets the same rules, since it becomes a path", () => {
    assert.ok(!ok("elasticsearch", "validatePattern", "../_cluster"));
    assert.ok(ok("redis", "validatePattern", "user:*"));
  });
});
