import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "../helpers/client.js";

/**
 * What a client sees before any database is involved. Needs no server, so it
 * always runs, and it pins the parts of the contract that live in the
 * handshake: the tool list, the annotations, and starting with nothing
 * configured.
 */
describe("handshake with no configuration", () => {
  let client;

  before(async () => {
    client = new McpClient({ DB_URL: "", DB_PROFILES: "", MYSQL_USER: "", MYSQL_PROFILES: "" });
    await client.initialize();
  });

  after(async () => {
    await client.close();
  });

  test("advertises every tool", async () => {
    const names = (await client.listTools()).map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "aggregate",
      "connect",
      "count_documents",
      "current_connection",
      "describe_table",
      "distinct_values",
      "find_documents",
      "get_foreign_keys",
      "get_table_indexes",
      "get_table_sample",
      "list_connections",
      "list_databases",
      "list_tables",
      "redis_command",
      "run_query",
      "search",
      "use_connection",
      "use_database",
    ]);
  });

  test("every tool has a description, a title and all four hints", async () => {
    for (const tool of await client.listTools()) {
      assert.ok(tool.description?.length > 0, `${tool.name} has no description`);
      assert.ok(tool.title && tool.annotations?.title, `${tool.name} has no title`);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof tool.annotations[hint], "boolean", `${tool.name} is missing ${hint}`);
      }
    }
  });

  test("only the three connection-changing tools are not read-only, and none is destructive", async () => {
    const tools = await client.listTools();
    const writing = tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name).sort();
    assert.deepEqual(writing, ["connect", "use_connection", "use_database"]);
    assert.ok(tools.every((tool) => tool.annotations.destructiveHint === false));
  });

  test("an unconfigured server reports its state as ordinary output", async () => {
    const { text, isError } = await client.call("current_connection");
    assert.equal(isError, false);
    assert.match(text, /No active connection/);
  });

  test("a read before connecting names both ways out", async () => {
    const { text, isError } = await client.call("list_tables");
    assert.equal(isError, true);
    assert.match(text, /connect.*use_connection/);
  });

  test("connect with a bad URL fails without echoing the password", async () => {
    const { text, isError } = await client.call("connect", { url: "mysql://u:hunter2@db:nope/app" });
    assert.equal(isError, true);
    assert.match(text, /port must be a number/);
    assert.ok(!text.includes("hunter2"));
  });

  test("connect with an unknown scheme lists the supported ones", async () => {
    const { text } = await client.call("connect", { url: "oracle://db/app" });
    assert.match(text, /mysql, mariadb, postgres/);
  });
});

/**
 * Port 1 on localhost refuses every connection. Each engine's connect must
 * turn that into a prompt tool error. The Redis driver once retried a
 * refused first connection forever, so connect never returned; this pins the
 * behaviour for every engine, not only the one that broke.
 */
describe("connecting to a server that is not there", () => {
  let client;

  before(async () => {
    client = new McpClient({ DB_URL: "", DB_PROFILES: "", MYSQL_USER: "", MYSQL_PROFILES: "", DB_CONNECT_TIMEOUT_MS: "2000" });
    await client.initialize();
  });

  after(async () => {
    await client.close();
  });

  const unreachable = [
    "mysql://root@127.0.0.1:1/app",
    "postgres://postgres@127.0.0.1:1/app",
    "mssql://sa@127.0.0.1:1/app",
    "clickhouse://default@127.0.0.1:1",
    "mongodb://127.0.0.1:1/app",
    "redis://127.0.0.1:1/0",
    "elasticsearch://127.0.0.1:1",
  ];

  for (const url of unreachable) {
    test(`${url.split(":")[0]} fails promptly and leaves nothing active`, async () => {
      const started = Date.now();
      const { isError } = await client.call("connect", { url, alias: "down" });
      assert.equal(isError, true);
      assert.ok(Date.now() - started < 15000, `took ${Date.now() - started} ms`);
      assert.match((await client.call("current_connection")).text, /No active connection/);
    });
  }
});
