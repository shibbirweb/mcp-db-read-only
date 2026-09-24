import { test } from "node:test";
import assert from "node:assert/strict";
import { Redis } from "ioredis";
import { RedisDriver } from "../../../dist/drivers/keyvalue/RedisDriver.js";
import { directDriver, reason } from "./sql.js";

const BASE = process.env.TEST_REDIS_URL ?? "redis://:test_root_pw@127.0.0.1:6379";

// High-numbered databases, and every key prefixed, so a developer who runs
// the suite against their own local Redis loses nothing: teardown deletes
// only keys this file created.
const PRIMARY_DB = "14";
const ALT_DB = "15";
const PREFIX = "mcp_test:";
const url = (database) => `${BASE}/${database}`;

async function withClient(database, work) {
  // No retries: a refused connection must fail the probe, not retry forever.
  const client = new Redis(url(database), {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on("error", () => undefined);
  await client.connect();
  try {
    return await work(client);
  } finally {
    client.disconnect();
  }
}

async function removeFixtureKeys(client) {
  const keys = await client.keys(`${PREFIX}*`);
  if (keys.length > 0) {
    await client.del(...keys);
  }
}

export default {
  label: "Redis",
  database: PRIMARY_DB,
  objects: [`${PREFIX}author:1`, `${PREFIX}author:2`, `${PREFIX}books`],
  pattern: { glob: `${PREFIX}author:*`, includes: `${PREFIX}author:1`, excludes: `${PREFIX}books` },
  describe: { name: `${PREFIX}author:1`, match: /"type": "hash"/ },
  sample: { name: `${PREFIX}books`, match: /Earthsea/ },
  missing: `${PREFIX}ghost`,
  alt: { database: ALT_DB, object: `${PREFIX}widget:1`, missingFails: false },

  profiles: () => ({ primary: url(PRIMARY_DB) }),

  async probe() {
    try {
      await withClient(PRIMARY_DB, (client) => client.ping());
      return null;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    await this.teardown();
    await withClient(PRIMARY_DB, async (client) => {
      await client.hset(`${PREFIX}author:1`, { name: "Ursula", country: "US" });
      await client.hset(`${PREFIX}author:2`, { name: "Terry", country: "UK" });
      await client.rpush(`${PREFIX}books`, "A Wizard of Earthsea", "Mort");
      await client.set(`${PREFIX}greeting`, "hello");
    });
    await withClient(ALT_DB, (client) => client.set(`${PREFIX}widget:1`, "alpha"));
  },

  async teardown() {
    await withClient(PRIMARY_DB, removeFixtureKeys);
    await withClient(ALT_DB, removeFixtureKeys);
  },

  extraTests(call) {
    test("redis_command runs a read", async () => {
      const { text, isError } = await call("redis_command", { command: "HGET", args: [`${PREFIX}author:2`, "name"] });
      assert.equal(isError, false, text);
      assert.equal(JSON.parse(text), "Terry");
    });

    test("redis_command refuses a write before sending it", async () => {
      const { text, isError } = await call("redis_command", { command: "SET", args: [`${PREFIX}greeting`, "bye"] });
      assert.equal(isError, true);
      assert.match(text, /SET is not an allowed read-only command/);
    });

    test("KEYS is refused with a pointer to SCAN", async () => {
      const { text } = await call("redis_command", { command: "KEYS", args: ["*"] });
      assert.match(text, /SCAN/);
    });

    // The allowlist is bypassed entirely here: the driver asks the server
    // itself, and the server says SET is a write.
    test("the driver refuses a write the server flags as one, and nothing changes", async () => {
      const driver = directDriver(RedisDriver, url(PRIMARY_DB), () => undefined);
      try {
        await assert.rejects(() => driver.command("SET", [`${PREFIX}greeting`, "bye"]), /does not flag SET as read-only/);
      } finally {
        await driver.close();
      }
      assert.equal(await withClient(PRIMARY_DB, (client) => client.get(`${PREFIX}greeting`)), "hello");
    });

    test("describe_table reports a string key's length", async () => {
      const { text } = await call("describe_table", { table: `${PREFIX}greeting` });
      assert.match(text, /"type": "string"/);
      assert.match(text, /"length": 5/);
    });

    test("get_foreign_keys is reported as something Redis does not have", async () => {
      const { text } = await call("get_foreign_keys", { table: `${PREFIX}books` });
      assert.match(text, /Redis has no foreign keys/);
    });
  },
};
