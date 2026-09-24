import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@clickhouse/client";
import { ClickHouseDriver } from "../../../dist/drivers/sql/ClickHouseDriver.js";
import { TEST_DB, TEST_DB_ALT, connectionFields, directDriver, reason, sqlEngineTests } from "./sql.js";

const BASE = process.env.TEST_CLICKHOUSE_URL ?? "clickhouse://default:test_root_pw@127.0.0.1:8123";
const fields = connectionFields(BASE);
const url = (database) => `${BASE}/${database}`;

async function withClient(work) {
  const client = createClient({
    url: `http://${fields.host}:${fields.port}`,
    username: fields.user,
    password: fields.password,
    request_timeout: 10000,
  });
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

export default {
  label: "ClickHouse",
  database: TEST_DB,
  objects: ["authors", "books"],
  pattern: { glob: "auth*", includes: "authors", excludes: "books" },
  describe: { name: "authors", match: /"name": "name"/ },
  sample: { name: "books", match: /Earthsea|Mort/ },
  missing: "ghost",
  alt: { database: TEST_DB_ALT, object: "widgets", missingFails: true },

  profiles: () => ({ primary: url(TEST_DB) }),

  async probe() {
    try {
      await withClient(async (client) => (await client.query({ query: "SELECT 1", format: "JSONEachRow" })).json());
      return null;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    await this.teardown();
    await withClient(async (client) => {
      const statements = [
        `CREATE DATABASE ${TEST_DB}`,
        `CREATE DATABASE ${TEST_DB_ALT}`,
        `CREATE TABLE ${TEST_DB}.authors (id UInt32, name String, INDEX authors_name_unique name TYPE bloom_filter GRANULARITY 1) ENGINE = MergeTree ORDER BY id`,
        `CREATE TABLE ${TEST_DB}.books (id UInt32, author_id UInt32, title String) ENGINE = MergeTree ORDER BY id`,
        `INSERT INTO ${TEST_DB}.authors VALUES (1, 'Ursula'), (2, 'Terry')`,
        `INSERT INTO ${TEST_DB}.books VALUES (1, 1, 'A Wizard of Earthsea'), (2, 2, 'Mort')`,
        `CREATE TABLE ${TEST_DB_ALT}.widgets (id UInt32, label String) ENGINE = MergeTree ORDER BY id`,
      ];
      for (const statement of statements) {
        await client.command({ query: statement });
      }
    });
  },

  async teardown() {
    await withClient(async (client) => {
      await client.command({ query: `DROP DATABASE IF EXISTS ${TEST_DB}` });
      await client.command({ query: `DROP DATABASE IF EXISTS ${TEST_DB_ALT}` });
    });
  },

  extraTests(call) {
    sqlEngineTests(call, {
      countSql: "SELECT count() AS total FROM authors",
      writeSql: "INSERT INTO authors VALUES (3, 'Mallory')",
      // ClickHouse has sorting keys and skipping indices rather than B-trees.
      indexMatch: /authors_name_unique|sorting_key/,
      foreignKeys: false,
      async provesLayerTwo() {
        const driver = directDriver(ClickHouseDriver, url(TEST_DB));
        try {
          await assert.rejects(() => driver.query("INSERT INTO authors VALUES (3, 'Mallory')"), /readonly/i);
          await assert.rejects(() => driver.query("DROP TABLE books"), /readonly/i);
        } finally {
          await driver.close();
        }
      },
    });

    test("foreign keys are reported as something ClickHouse does not have", async () => {
      const { text, isError } = await call("get_foreign_keys", { table: "books" });
      assert.equal(isError, true);
      assert.match(text, /ClickHouse has no foreign keys/);
    });

    test("table functions that reach outside the server are refused", async () => {
      const { text } = await call("run_query", { query: "SELECT * FROM url('http://169.254.169.254/', CSV, 'x String')" });
      assert.match(text, /reaches outside the ClickHouse server/);
    });
  },
};
