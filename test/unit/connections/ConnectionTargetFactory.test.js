import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionTargetFactory } from "../../../dist/connections/ConnectionTargetFactory.js";
import { ConnectionUrlParser } from "../../../dist/connections/ConnectionUrlParser.js";

const factory = new ConnectionTargetFactory(new ConnectionUrlParser(), (path) => `/work/${path}`);

describe("from a URL", () => {
  test("a separate password replaces the URL's", () => {
    const subject = factory.fromUrl("postgres://u:inurl@db/app", "p@ss/word#1");
    assert.equal(subject.password, "p@ss/word#1");
  });

  test("an empty separate password keeps the URL's", () => {
    assert.equal(factory.fromUrl("postgres://u:inurl@db/app", "").password, "inurl");
  });

  test("a SQLite path is made absolute once, at construction", () => {
    assert.equal(factory.fromUrl("sqlite://app.db").database, "/work/app.db");
  });
});

describe("legacy MYSQL_PROFILES entries", () => {
  test("defaults the host to the Docker host and the port to 3306", () => {
    const subject = factory.fromMySqlDefinition({ user: "u", database: "d" }, "p");
    assert.equal(subject.engine, "mysql");
    assert.equal(subject.host, "host.docker.internal");
    assert.equal(subject.port, 3306);
  });

  test("requires user", () => {
    assert.throws(() => factory.fromMySqlDefinition({ database: "d" }, "broken"), /"broken" is missing "user"/);
  });

  test("requires database", () => {
    assert.throws(() => factory.fromMySqlDefinition({ user: "u" }, "broken"), /missing "database"/);
  });

  test("a port given as a string falls back to the default", () => {
    assert.equal(factory.fromMySqlDefinition({ user: "u", database: "d", port: "3307" }, "p").port, 3306);
  });

  test("a numeric port is kept", () => {
    assert.equal(factory.fromMySqlDefinition({ user: "u", database: "d", port: 3307 }, "p").port, 3307);
  });
});
