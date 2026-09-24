import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DriverCache } from "../../../dist/drivers/DriverCache.js";
import { DriverRegistry } from "../../../dist/drivers/DriverRegistry.js";
import { target } from "../../helpers/targets.js";

/** Records what happened to it, and fails verification on request. */
class FakeDriver {
  constructor(driverTarget, { failVerify = false } = {}) {
    this.target = driverTarget;
    this.closed = false;
    this.failVerify = failVerify;
  }

  async verify() {
    if (this.failVerify) {
      throw new Error("unreachable");
    }
  }

  async close() {
    this.closed = true;
  }
}

function build({ max = 3, failVerify = false } = {}) {
  const created = [];
  const registry = new DriverRegistry().register("mysql", (driverTarget) => {
    const driver = new FakeDriver(driverTarget, { failVerify });
    created.push(driver);
    return driver;
  });
  return { cache: new DriverCache(registry, max), created };
}

describe("reuse", () => {
  test("the same target returns the same driver", async () => {
    const { cache } = build();
    const first = await cache.acquire(target());
    const second = await cache.acquire(target());
    assert.equal(first, second);
    assert.equal(cache.size, 1);
  });

  test("a different database is a different driver", async () => {
    const { cache } = build();
    const a = await cache.acquire(target({ database: "a" }));
    const b = await cache.acquire(target({ database: "b" }));
    assert.notEqual(a, b);
  });

  // The key excludes the password by design, so without this a reconnect
  // with a corrected password would keep reusing the broken driver.
  test("a changed password replaces the cached driver and closes the old one", async () => {
    const { cache } = build();
    const old = await cache.acquire(target({ password: "wrong" }));
    const fresh = await cache.acquire(target({ password: "right" }));
    assert.notEqual(old, fresh);
    assert.equal(old.closed, true);
    assert.equal(cache.size, 1);
  });
});

describe("LRU eviction", () => {
  test("the least recently used driver is closed past the cap", async () => {
    const { cache, created } = build({ max: 2 });
    await cache.acquire(target({ database: "a" }));
    await cache.acquire(target({ database: "b" }));
    await cache.acquire(target({ database: "a" }));
    await cache.acquire(target({ database: "c" }));

    assert.equal(cache.size, 2);
    assert.equal(created.find((driver) => driver.target.database === "b").closed, true);
    assert.equal(created.find((driver) => driver.target.database === "a").closed, false);
  });
});

describe("verify", () => {
  test("a failed verification evicts and closes the driver", async () => {
    const { cache, created } = build({ failVerify: true });
    await assert.rejects(() => cache.verify(target()), /unreachable/);
    assert.equal(cache.size, 0);
    assert.equal(created[0].closed, true);
  });
});

describe("closeAll", () => {
  test("closes everything and empties the cache", async () => {
    const { cache, created } = build();
    await cache.acquire(target({ database: "a" }));
    await cache.acquire(target({ database: "b" }));
    await cache.closeAll();
    assert.equal(cache.size, 0);
    assert.ok(created.every((driver) => driver.closed));
  });
});
