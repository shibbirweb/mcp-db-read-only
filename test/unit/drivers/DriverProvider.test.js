import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionRegistry } from "../../../dist/connections/ConnectionRegistry.js";
import { ConnectionProfile } from "../../../dist/domain/ConnectionProfile.js";
import { DriverProvider } from "../../../dist/drivers/DriverProvider.js";
import { QUERY_TOOLS } from "../../../dist/tools/QueryTools.js";
import { engineTarget } from "../../helpers/targets.js";

function build(engine) {
  const registry = new ConnectionRegistry([ConnectionProfile.fromEnvironment("active", engineTarget(engine))]);
  registry.selectInitial(null);
  const cache = {
    acquired: [],
    async acquire(target) {
      this.acquired.push(target);
      return { family: "fake", target };
    },
  };
  return { provider: new DriverProvider(registry, cache, QUERY_TOOLS), cache };
}

describe("resolving the target", () => {
  test("no database means the active connection", () => {
    const { provider } = build("postgres");
    assert.equal(provider.resolveTarget().database, "app");
  });

  test("a database means the active connection pointed there, for this call only", () => {
    const { provider } = build("postgres");
    assert.equal(provider.resolveTarget("other").database, "other");
    assert.equal(provider.requireActiveTarget().database, "app");
  });

  test("SQLite refuses a database override", () => {
    const { provider } = build("sqlite");
    assert.throws(() => provider.resolveTarget("other"), /SQLite has no separate databases/);
  });

  test("nothing configured says how to connect", () => {
    const provider = new DriverProvider(new ConnectionRegistry(), {}, QUERY_TOOLS);
    assert.throws(() => provider.resolveTarget(), /No active connection.*connect/);
  });
});

describe("engine families", () => {
  test("a SQL tool on MongoDB names the MongoDB tools", async () => {
    const { provider } = build("mongodb");
    await assert.rejects(
      () => provider.acquireSql(provider.requireActiveTarget(), "run_query"),
      /run_query works on MySQL, PostgreSQL, SQLite, SQL Server, ClickHouse connections, but the active connection is MongoDB\. Use find_documents, aggregate, count_documents, distinct_values/
    );
  });

  test("a mismatch is reported before any driver is acquired", async () => {
    const { provider, cache } = build("redis");
    await assert.rejects(() => provider.acquireSearch(provider.requireActiveTarget(), "search"));
    assert.deepEqual(cache.acquired, []);
  });

  test("the matching family acquires the driver", async () => {
    const { provider, cache } = build("redis");
    await provider.acquireKeyValue(provider.requireActiveTarget(), "redis_command");
    assert.equal(cache.acquired.length, 1);
  });
});
