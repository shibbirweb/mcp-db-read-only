import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EngineCatalog } from "../../../dist/domain/Engine.js";

describe("engine catalog", () => {
  test("every scheme belongs to exactly one engine", () => {
    const names = EngineCatalog.schemeNames();
    assert.equal(new Set(names).size, names.length);
  });

  test("scheme lookup ignores case", () => {
    assert.equal(EngineCatalog.findScheme("PostgreSQL").engine.engine, "postgres");
  });

  test("MariaDB and OpenSearch map onto their compatible engines", () => {
    assert.equal(EngineCatalog.findScheme("mariadb").engine.engine, "mysql");
    assert.equal(EngineCatalog.findScheme("opensearch").engine.engine, "elasticsearch");
  });

  test("an unknown scheme is undefined rather than a guess", () => {
    assert.equal(EngineCatalog.findScheme("oracle"), undefined);
  });

  test("only SQLite and Elasticsearch refuse database switching", () => {
    const refusing = EngineCatalog.all()
      .filter((engine) => !engine.switchesDatabases)
      .map((engine) => engine.engine)
      .sort();
    assert.deepEqual(refusing, ["elasticsearch", "sqlite"]);
  });

  test("only MongoDB accepts several hosts", () => {
    const multi = EngineCatalog.all()
      .filter((engine) => engine.multipleHosts)
      .map((engine) => engine.engine);
    assert.deepEqual(multi, ["mongodb"]);
  });

  test("labels for a family name every engine in it", () => {
    assert.equal(
      EngineCatalog.labelsFor("sql"),
      "MySQL, PostgreSQL, SQLite, SQL Server, ClickHouse"
    );
  });

  test("secure schemes are marked", () => {
    assert.equal(EngineCatalog.scheme("rediss").secure, true);
    assert.equal(EngineCatalog.scheme("redis").secure, false);
    assert.equal(EngineCatalog.scheme("clickhouse+https").defaultPort, 8443);
  });
});
