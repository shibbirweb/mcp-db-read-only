import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PostgresDriver } from "../../../dist/drivers/sql/PostgresDriver.js";
import { TEST_DB, TEST_DB_ALT, connectionFields, directDriver, reason, sqlEngineTests } from "./sql.js";

const BASE = process.env.TEST_POSTGRES_URL ?? "postgres://postgres:test_root_pw@127.0.0.1:5432";
const fields = connectionFields(BASE);
const url = (database) => `${BASE}/${database}`;

async function withClient(database, work) {
  const client = new pg.Client({ ...fields, database, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export default {
  label: "PostgreSQL",
  database: TEST_DB,
  objects: ["authors", "books", "reporting.monthly"],
  pattern: { glob: "auth*", includes: "authors", excludes: "books" },
  describe: { name: "authors", match: /"column_name": "name"/ },
  sample: { name: "books", match: /Earthsea|Mort/ },
  missing: "ghost",
  alt: { database: TEST_DB_ALT, object: "widgets", missingFails: true },

  profiles: () => ({ primary: url(TEST_DB) }),

  async probe() {
    try {
      await withClient("postgres", (client) => client.query("SELECT 1"));
      return null;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    await this.teardown();
    await withClient("postgres", async (client) => {
      await client.query(`CREATE DATABASE ${TEST_DB}`);
      await client.query(`CREATE DATABASE ${TEST_DB_ALT}`);
    });
    await withClient(TEST_DB, (client) =>
      client.query(`
        CREATE TABLE authors (id SERIAL PRIMARY KEY, name TEXT NOT NULL CONSTRAINT authors_name_unique UNIQUE);
        CREATE TABLE books (id SERIAL PRIMARY KEY, author_id INT NOT NULL REFERENCES authors (id), title TEXT NOT NULL);
        INSERT INTO authors (name) VALUES ('Ursula'), ('Terry');
        INSERT INTO books (author_id, title) VALUES (1, 'A Wizard of Earthsea'), (2, 'Mort');
        CREATE SCHEMA reporting;
        CREATE TABLE reporting.monthly (month DATE, total INT);
        CREATE TABLE events (at TIMESTAMP);
        INSERT INTO events VALUES ('2026-01-02 03:04:05');`)
    );
    await withClient(TEST_DB_ALT, (client) =>
      client.query("CREATE TABLE widgets (id INT PRIMARY KEY, label TEXT); INSERT INTO widgets VALUES (1, 'alpha');")
    );
  },

  async teardown() {
    await withClient("postgres", async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await client.query(`DROP DATABASE IF EXISTS ${TEST_DB_ALT} WITH (FORCE)`);
    });
  },

  extraTests(call) {
    sqlEngineTests(call, {
      countSql: "SELECT COUNT(*) AS total FROM authors",
      writeSql: "INSERT INTO authors (name) VALUES ('Mallory')",
      indexMatch: /authors_name_unique/,
      foreignKeys: true,
      async provesLayerTwo() {
        const driver = directDriver(PostgresDriver, url(TEST_DB));
        try {
          await assert.rejects(
            () => driver.query("INSERT INTO authors (name) VALUES ('Mallory')"),
            /read-only transaction/
          );
          // Even a set_config smuggled past the validator is rolled back.
          await driver.query("SELECT set_config('default_transaction_read_only', 'off', false)");
          await assert.rejects(() => driver.query("INSERT INTO authors (name) VALUES ('Mallory')"), /read-only/);
        } finally {
          await driver.close();
        }
      },
    });

    // pg would otherwise parse this into a Date and print it shifted to UTC.
    test("timestamps come back exactly as stored", async () => {
      const { text } = await call("run_query", { query: "SELECT at FROM events" });
      assert.match(text, /"2026-01-02 03:04:05"/);
    });

    test("a schema-qualified table can be described", async () => {
      const { text, isError } = await call("describe_table", { table: "reporting.monthly" });
      assert.equal(isError, false, text);
      assert.match(text, /"column_name": "month"/);
    });

    test("dollar-quoted text is data, not SQL", async () => {
      const { text, isError } = await call("run_query", { query: "SELECT $$ ; DELETE FROM authors; $$ AS s" });
      assert.equal(isError, false, text);
    });
  },
};
