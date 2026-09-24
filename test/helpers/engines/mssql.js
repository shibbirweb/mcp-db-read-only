import { test } from "node:test";
import assert from "node:assert/strict";
import sql from "mssql";
import { MsSqlDriver } from "../../../dist/drivers/sql/MsSqlDriver.js";
import { TEST_DB, TEST_DB_ALT, connectionFields, directDriver, reason, sqlEngineTests } from "./sql.js";

const BASE = process.env.TEST_MSSQL_URL ?? "mssql://sa:Test_root_pw1@127.0.0.1:1433";
const fields = connectionFields(BASE);
// A development container presents a self-signed certificate.
const url = (database) => `${BASE}/${database}?trustServerCertificate=true`;

async function withPool(database, work) {
  const pool = new sql.ConnectionPool({
    server: fields.host,
    port: fields.port,
    user: fields.user,
    password: fields.password,
    database,
    connectionTimeout: 5000,
    options: { trustServerCertificate: true },
  });
  await pool.connect();
  try {
    return await work(pool);
  } finally {
    await pool.close();
  }
}

async function count() {
  return withPool(TEST_DB, async (pool) => (await pool.request().query("SELECT COUNT(*) AS total FROM authors")).recordset[0].total);
}

export default {
  label: "SQL Server",
  database: TEST_DB,
  objects: ["authors", "books", "reporting.monthly"],
  pattern: { glob: "auth*", includes: "authors", excludes: "books" },
  describe: { name: "authors", match: /"COLUMN_NAME": "name"/ },
  sample: { name: "books", match: /Earthsea|Mort/ },
  missing: "ghost",
  alt: { database: TEST_DB_ALT, object: "widgets", missingFails: true },

  profiles: () => ({ primary: url(TEST_DB) }),

  async probe() {
    try {
      await withPool("master", (pool) => pool.request().query("SELECT 1"));
      return null;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    await this.teardown();
    await withPool("master", async (pool) => {
      await pool.request().query(`CREATE DATABASE ${TEST_DB}`);
      await pool.request().query(`CREATE DATABASE ${TEST_DB_ALT}`);
    });
    await withPool(TEST_DB, async (pool) => {
      await pool.request().query(`
        CREATE TABLE authors (id INT IDENTITY PRIMARY KEY, name NVARCHAR(100) NOT NULL CONSTRAINT authors_name_unique UNIQUE);
        CREATE TABLE books (id INT IDENTITY PRIMARY KEY, author_id INT NOT NULL CONSTRAINT books_author_id_foreign REFERENCES authors (id), title NVARCHAR(200) NOT NULL);
        INSERT INTO authors (name) VALUES ('Ursula'), ('Terry');
        INSERT INTO books (author_id, title) VALUES (1, 'A Wizard of Earthsea'), (2, 'Mort');`);
      await pool.request().query("EXEC('CREATE SCHEMA reporting')");
      await pool.request().query("CREATE TABLE reporting.monthly (month DATE, total INT)");
    });
    await withPool(TEST_DB_ALT, (pool) =>
      pool.request().query("CREATE TABLE widgets (id INT PRIMARY KEY, label NVARCHAR(50)); INSERT INTO widgets VALUES (1, 'alpha');")
    );
  },

  async teardown() {
    await withPool("master", async (pool) => {
      for (const database of [TEST_DB, TEST_DB_ALT]) {
        await pool.request().query(`IF DB_ID('${database}') IS NOT NULL BEGIN
          ALTER DATABASE ${database} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${database}; END`);
      }
    });
  },

  extraTests(call) {
    sqlEngineTests(call, {
      countSql: "SELECT COUNT(*) AS total FROM authors",
      writeSql: "INSERT INTO authors (name) VALUES ('Mallory')",
      indexMatch: /authors_name_unique/,
      foreignKeys: true,
      // SQL Server has no read-only session, so layer two is the rollback:
      // the write runs, then the transaction around it is undone.
      async provesLayerTwo() {
        const driver = directDriver(MsSqlDriver, url(TEST_DB));
        try {
          await driver.query("INSERT INTO authors (name) VALUES ('Mallory'); DELETE FROM books");
          assert.equal(await count(), 2);
        } finally {
          await driver.close();
        }
      },
    });

    test("a second statement without a semicolon is refused", async () => {
      const { isError } = await call("run_query", { query: "SELECT 1 AS a DELETE FROM books" });
      assert.equal(isError, true);
    });

    test("a column named like a keyword works once bracketed", async () => {
      const { isError, text } = await call("run_query", { query: "SELECT name AS [update] FROM authors" });
      assert.equal(isError, false, text);
    });
  },
};
