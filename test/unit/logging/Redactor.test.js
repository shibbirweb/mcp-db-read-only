import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Redactor } from "../../../dist/logging/Redactor.js";

const redactor = new Redactor();

describe("arguments named like secrets", () => {
  test("are masked at any depth", () => {
    assert.deepEqual(redactor.redact({ alias: "x", password: "p", nested: { api_key: "k", Token: "t" } }), {
      alias: "x",
      password: "***",
      nested: { api_key: "***", Token: "***" },
    });
  });

  test("an empty password stays empty, since there is nothing to hide", () => {
    assert.deepEqual(redactor.redact({ password: "" }), { password: "" });
  });

  test("ordinary arguments are untouched", () => {
    const args = { query: "SELECT 1", limit: 5, filter: { status: "active" } };
    assert.deepEqual(redactor.redact(args), args);
  });
});

describe("connection URLs", () => {
  test("the password is masked and everything else kept", () => {
    assert.equal(redactor.redactUrl("postgres://reader:hunter2@db:5432/app"), "postgres://reader:***@db:5432/app");
  });

  test("an unencoded @ in the password is masked whole, as the parser splits it", () => {
    assert.equal(redactor.redactUrl("mysql://u:p@ss@db/app"), "mysql://u:***@db/app");
  });

  test("a URL with only a user, or no credentials, is unchanged", () => {
    assert.equal(redactor.redactUrl("mysql://reader@db/app"), "mysql://reader@db/app");
    assert.equal(redactor.redactUrl("redis://cache:6379/0"), "redis://cache:6379/0");
  });

  test("Redis-style password-only credentials are masked", () => {
    assert.equal(redactor.redactUrl("redis://:secret@cache:6379/0"), "redis://:***@cache:6379/0");
  });

  test("secret query parameters are masked, others kept", () => {
    assert.equal(
      redactor.redactUrl("elasticsearch://es:9200?api_key=abc&timeout=5s"),
      "elasticsearch://es:9200?api_key=***&timeout=5s"
    );
  });

  test("URLs inside arguments are redacted", () => {
    assert.deepEqual(redactor.redact({ url: "mongodb://u:pw@a,b/app" }), { url: "mongodb://u:***@a,b/app" });
  });

  test("text that is not a URL is left alone", () => {
    assert.equal(redactor.redactUrl("user:pass@host is not a URL"), "user:pass@host is not a URL");
  });
});

describe("hostile shapes", () => {
  test("absurd nesting is cut off rather than recursed into", () => {
    let deep = {};
    for (let i = 0; i < 100; i += 1) {
      deep = { a: deep };
    }
    assert.match(JSON.stringify(redactor.redact(deep)), /nested too deeply/);
  });
});
