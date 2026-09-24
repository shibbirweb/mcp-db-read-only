import { test } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { MongoDriver } from "../../../dist/drivers/document/MongoDriver.js";
import { TEST_DB, TEST_DB_ALT, directDriver, reason } from "./sql.js";

const BASE = process.env.TEST_MONGODB_URL ?? "mongodb://root:test_root_pw@127.0.0.1:27017";
const url = (database) => `${BASE}/${database}?authSource=admin`;

async function withClient(work) {
  const client = new MongoClient(`${BASE}/?authSource=admin`, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

export default {
  label: "MongoDB",
  database: TEST_DB,
  objects: ["authors", "books"],
  pattern: { glob: "auth*", includes: "authors", excludes: "books" },
  describe: { name: "authors", match: /"path": "name"/ },
  sample: { name: "books", match: /Earthsea|Mort/ },
  missing: "ghost",
  // MongoDB creates a database on first write, so switching to one that does
  // not exist yet succeeds and simply finds nothing there.
  alt: { database: TEST_DB_ALT, object: "widgets", missingFails: false },

  profiles: () => ({ primary: url(TEST_DB) }),

  async probe() {
    try {
      await withClient((client) => client.db("admin").command({ ping: 1 }));
      return null;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    await this.teardown();
    await withClient(async (client) => {
      const db = client.db(TEST_DB);
      await db.collection("authors").insertMany([
        { _id: 1, name: "Ursula", country: "US" },
        { _id: 2, name: "Terry", country: "UK" },
      ]);
      await db.collection("authors").createIndex({ name: 1 }, { unique: true, name: "authors_name_unique" });
      await db.collection("books").insertMany([
        { author_id: 1, title: "A Wizard of Earthsea", year: 1968 },
        { author_id: 2, title: "Mort", year: 1987 },
      ]);
      await client.db(TEST_DB_ALT).collection("widgets").insertOne({ label: "alpha" });
    });
  },

  async teardown() {
    await withClient(async (client) => {
      await client.db(TEST_DB).dropDatabase();
      await client.db(TEST_DB_ALT).dropDatabase();
    });
  },

  extraTests(call) {
    test("find_documents filters and projects", async () => {
      const { text, isError } = await call("find_documents", {
        collection: "authors",
        filter: { country: "UK" },
        projection: { _id: 0, name: 1 },
      });
      assert.equal(isError, false, text);
      assert.deepEqual(JSON.parse(text), [{ name: "Terry" }]);
    });

    test("aggregate runs a read-only pipeline", async () => {
      const { text, isError } = await call("aggregate", {
        collection: "books",
        pipeline: [{ $group: { _id: null, total: { $sum: 1 } } }],
      });
      assert.equal(isError, false, text);
      assert.equal(JSON.parse(text)[0].total, 2);
    });

    test("aggregate refuses $out before it reaches the server", async () => {
      const { text, isError } = await call("aggregate", { collection: "books", pipeline: [{ $out: "stolen" }] });
      assert.equal(isError, true);
      assert.match(text, /\$out writes the result/);
    });

    test("the driver refuses $out on its own, and nothing is written", async () => {
      const driver = directDriver(MongoDriver, url(TEST_DB));
      try {
        await assert.rejects(() => driver.aggregate("books", [{ $out: "stolen" }], 10), /not allowed/);
      } finally {
        await driver.close();
      }
      const collections = await withClient((client) => client.db(TEST_DB).listCollections({ name: "stolen" }).toArray());
      assert.deepEqual(collections, []);
    });

    test("count_documents counts", async () => {
      const { text } = await call("count_documents", { collection: "books", filter: { year: { $gt: 1970 } } });
      assert.match(text, /^1 matching document in "books"/);
    });

    test("distinct_values lists distinct values", async () => {
      const { text } = await call("distinct_values", { collection: "authors", field: "country" });
      assert.deepEqual(JSON.parse(text).sort(), ["UK", "US"]);
    });

    test("get_table_indexes shows the unique index", async () => {
      const { text } = await call("get_table_indexes", { table: "authors" });
      assert.match(text, /authors_name_unique/);
    });

    test("run_query on MongoDB names the MongoDB tools instead", async () => {
      const { text, isError } = await call("run_query", { query: "SELECT 1" });
      assert.equal(isError, true);
      assert.match(text, /active connection is MongoDB\. Use find_documents/);
    });

    test("$where in a filter is refused", async () => {
      const { isError } = await call("find_documents", { collection: "books", filter: { $where: "true" } });
      assert.equal(isError, true);
    });
  },
};
