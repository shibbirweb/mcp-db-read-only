import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { MySqlDriver } from "../../../dist/drivers/sql/MySqlDriver.js";
import { TEST_DB, TEST_DB_ALT, connectionFields, directDriver, reason, sqlEngineTests } from "./sql.js";

const BASE = process.env.TEST_MYSQL_URL ?? "mysql://root:test_root_pw@127.0.0.1:3306";
const fields = connectionFields(BASE);
const url = (database) => `${BASE}/${database}`;
const connect = (options = {}) => mysql.createConnection({ ...fields, connectTimeout: 3000, ...options });

export default {
  label: "MySQL",
  database: TEST_DB,
  objects: ["authors", "books"],
  pattern: { glob: "auth*", includes: "authors", excludes: "books" },
  describe: { name: "authors", match: /"Field": "name"/ },
  sample: { name: "books", match: /Earthsea|Mort/ },
  missing: "ghost",
  alt: { database: TEST_DB_ALT, object: "widgets", missingFails: true },

  profiles: () => ({ primary: url(TEST_DB) }),

  async probe() {
    try {
      const conn = await connect();
      await conn.end();
      return null;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    const conn = await connect({ multipleStatements: true });
    await conn.query(`DROP DATABASE IF EXISTS ${TEST_DB}; DROP DATABASE IF EXISTS ${TEST_DB_ALT};
      CREATE DATABASE ${TEST_DB}; CREATE DATABASE ${TEST_DB_ALT};
      CREATE TABLE ${TEST_DB}.authors (id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(100) NOT NULL, UNIQUE KEY authors_name_unique (name));
      CREATE TABLE ${TEST_DB}.books (id INT PRIMARY KEY AUTO_INCREMENT, author_id INT NOT NULL, title VARCHAR(200) NOT NULL,
        CONSTRAINT books_author_id_foreign FOREIGN KEY (author_id) REFERENCES ${TEST_DB}.authors (id));
      INSERT INTO ${TEST_DB}.authors (name) VALUES ('Ursula'), ('Terry');
      INSERT INTO ${TEST_DB}.books (author_id, title) VALUES (1, 'A Wizard of Earthsea'), (2, 'Mort');
      CREATE TABLE ${TEST_DB_ALT}.widgets (id INT PRIMARY KEY, label VARCHAR(50));
      INSERT INTO ${TEST_DB_ALT}.widgets VALUES (1, 'alpha');`);
    await conn.end();
  },

  async teardown() {
    const conn = await connect({ multipleStatements: true });
    await conn.query(`DROP DATABASE IF EXISTS ${TEST_DB}; DROP DATABASE IF EXISTS ${TEST_DB_ALT};`);
    await conn.end();
  },

  extraTests(call) {
    sqlEngineTests(call, {
      countSql: "SELECT COUNT(*) AS total FROM authors",
      writeSql: "INSERT INTO authors (name) VALUES ('Mallory')",
      indexMatch: /authors_name_unique/,
      foreignKeys: true,
      async provesLayerTwo() {
        const driver = directDriver(MySqlDriver, url(TEST_DB), () => undefined);
        try {
          await assert.rejects(() => driver.query("INSERT INTO authors (name) VALUES ('Mallory')"), /READ ONLY|read-only/i);
        } finally {
          await driver.close();
        }
      },
    });
  },
};
