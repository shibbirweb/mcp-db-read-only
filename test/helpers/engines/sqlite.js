import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteDriver } from "../../../dist/drivers/sql/SqliteDriver.js";
import { directDriver, sqlEngineTests } from "./sql.js";

// Created in seed rather than at import: `node --test` also runs every file
// under test/ as a test file, and an import-time temp directory would then be
// created by a run that never tears it down.
let directory = "";
let path = "";
const url = () => `sqlite://${path}`;

function count() {
  const database = new DatabaseSync(path, { readOnly: true });
  const { total } = database.prepare("SELECT COUNT(*) AS total FROM authors").get();
  database.close();
  return total;
}

/** SQLite needs no server, so this suite always runs. */
export default {
  label: "SQLite",
  get database() {
    return path;
  },
  objects: ["authors", "books"],
  pattern: { glob: "auth*", includes: "authors", excludes: "books" },
  describe: { name: "authors", match: /"name": "name"/ },
  sample: { name: "books", match: /Earthsea|Mort/ },
  missing: "ghost",
  alt: null,

  profiles: () => ({ file: url() }),

  async probe() {
    return null;
  },

  async seed() {
    directory = mkdtempSync(join(tmpdir(), "mcp-db-ro-"));
    path = join(directory, "fixture.db");
    const database = new DatabaseSync(path);
    database.exec(`
      CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE UNIQUE INDEX authors_name_unique ON authors (name);
      CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES authors (id), title TEXT NOT NULL, cover BLOB);
      INSERT INTO authors (name) VALUES ('Ursula'), ('Terry');
      INSERT INTO books (author_id, title, cover) VALUES (1, 'A Wizard of Earthsea', x'89504e47'), (2, 'Mort', NULL);
    `);
    database.close();
  },

  async teardown() {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  },

  extraTests(call) {
    sqlEngineTests(call, {
      countSql: "SELECT COUNT(*) AS total FROM authors",
      writeSql: "INSERT INTO authors (name) VALUES ('Mallory')",
      indexMatch: /authors_name_unique/,
      foreignKeys: true,
      async provesLayerTwo() {
        const driver = directDriver(SqliteDriver, url());
        try {
          await assert.rejects(() => driver.query("INSERT INTO authors (name) VALUES ('Mallory')"), /readonly/);
          // query_only can be switched off from SQL; the file-level read-only
          // flag underneath it cannot.
          await driver.query("PRAGMA query_only = OFF");
          await assert.rejects(() => driver.query("DELETE FROM authors"), /readonly/);
          assert.equal(count(), 2);
        } finally {
          await driver.close();
        }
      },
    });

    // SQLite's prepare silently ignores a second statement, so without the
    // validator's single-statement rule this would report success.
    test("a stacked statement is refused rather than half-run", async () => {
      const { isError } = await call("run_query", { query: "SELECT 1; DELETE FROM authors" });
      assert.equal(isError, true);
      assert.equal(count(), 2);
    });

    test("binary columns are summarised, not dumped byte by byte", async () => {
      const { text } = await call("run_query", { query: "SELECT cover FROM books WHERE id = 1" });
      assert.match(text, /<binary 4 bytes: 0x89504e47>/);
    });

    test("use_database is refused with the way to open another file", async () => {
      const { text, isError } = await call("use_database", { database: "other" });
      assert.equal(isError, true);
      assert.match(text, /The file is the database/);
    });

    test("a missing file fails at connect, and the session keeps working", async () => {
      const { text, isError } = await call("connect", { url: `sqlite://${join(directory, "nope.db")}`, alias: "nope" });
      assert.equal(isError, true);
      assert.match(text, /Could not open SQLite database/);
      assert.match((await call("list_tables")).text, /authors/);
    });

    test("a runaway query is stopped at the timeout and the next query works", async () => {
      const slowClient = await import("../client.js");
      const client = new slowClient.McpClient({ DB_URL: url(), DB_QUERY_TIMEOUT_MS: "300" });
      try {
        await client.initialize();
        const endless = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT COUNT(*) FROM n";
        const { text, isError } = await client.call("run_query", { query: endless });
        assert.equal(isError, true);
        assert.match(text, /exceeded 300 ms/);
        const after = await client.call("run_query", { query: "SELECT COUNT(*) AS total FROM authors" });
        assert.equal(after.isError, false, after.text);
      } finally {
        await client.close();
      }
    });
  },
};
