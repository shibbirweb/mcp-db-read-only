import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionTargetFactory } from "../../../dist/connections/ConnectionTargetFactory.js";
import { TEST_TUNING } from "../engineSuite.js";

/** Primary and alternate fixture database names, shared by every SQL engine. */
export const TEST_DB = "mcp_test";
export const TEST_DB_ALT = "mcp_test_alt";

/** Splits a base URL like `mysql://root:pw@127.0.0.1:3306` into driver fields. */
export function connectionFields(baseUrl) {
  const url = new URL(baseUrl.replace(/^[a-z+]+:/, "http:"));
  return {
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export function reason(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Builds the driver under test directly, bypassing every tool and validator. */
export function directDriver(DriverClass, url, ...extra) {
  const target = new ConnectionTargetFactory().fromUrl(url);
  return new DriverClass(target, TEST_TUNING, ...extra);
}

/**
 * The tests every SQL engine shares: run_query reads, run_query refuses a
 * write before sending it, and the driver itself refuses a write sent
 * straight to it, which is what proves layer two exists independently of the
 * validator.
 *
 * @param options.countSql a query answering with a column named `total`
 * @param options.writeSql a write the validator would refuse
 * @param options.provesLayerTwo sends writeSql straight to the driver and asserts the server refused or undid it
 */
export function sqlEngineTests(call, options) {
  test("run_query answers a read", async () => {
    const { text, isError } = await call("run_query", { query: options.countSql });
    assert.equal(isError, false, text);
    assert.equal(Number(JSON.parse(text)[0].total), 2);
  });

  test("run_query refuses a write before it reaches the server", async () => {
    const { text, isError } = await call("run_query", { query: options.writeSql });
    assert.equal(isError, true);
    assert.match(text, /^Error: Only /);
  });

  test("run_query refuses stacked statements", async () => {
    const { isError } = await call("run_query", { query: `${options.countSql}; ${options.writeSql}` });
    assert.equal(isError, true);
  });

  test("a write sent straight to the driver is refused or undone by the server", async () => {
    await options.provesLayerTwo();
  });

  if (options.foreignKeys) {
    test("get_foreign_keys finds the books -> authors relationship", async () => {
      const { text, isError } = await call("get_foreign_keys", { table: "books" });
      assert.equal(isError, false, text);
      assert.match(text, /authors/);
    });

    test("get_foreign_keys says so plainly when there are none", async () => {
      const { text } = await call("get_foreign_keys", { table: "authors" });
      assert.match(text, /No foreign keys/);
    });
  }

  test("get_table_indexes shows the unique index on author names", async () => {
    const { text, isError } = await call("get_table_indexes", { table: "authors" });
    assert.equal(isError, false, text);
    assert.match(text, options.indexMatch);
  });

  test("a document tool on a SQL connection names run_query", async () => {
    const { text, isError } = await call("find_documents", { collection: "authors" });
    assert.equal(isError, true);
    assert.match(text, /Use run_query/);
  });
}
