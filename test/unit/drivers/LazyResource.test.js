import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LazyResource } from "../../../dist/drivers/LazyResource.js";

describe("opening", () => {
  test("nothing opens until first use", () => {
    let opens = 0;
    new LazyResource(async () => {
      opens += 1;
      return {};
    }, async () => undefined);
    assert.equal(opens, 0);
  });

  test("concurrent first calls share one open", async () => {
    let opens = 0;
    const resource = new LazyResource(async () => {
      opens += 1;
      return { id: opens };
    }, async () => undefined);

    const [a, b] = await Promise.all([resource.get(), resource.get()]);
    assert.equal(opens, 1);
    assert.equal(a, b);
  });

  // Without this, a server that was down when first asked would stay "down"
  // for the life of the process.
  test("a failed open is forgotten, so the next call tries again", async () => {
    let attempt = 0;
    const resource = new LazyResource(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("down");
      }
      return "up";
    }, async () => undefined);

    await assert.rejects(() => resource.get(), /down/);
    assert.equal(await resource.get(), "up");
  });
});

describe("closing", () => {
  test("close disposes the opened resource", async () => {
    const disposed = [];
    const resource = new LazyResource(async () => "r", async (value) => {
      disposed.push(value);
    });
    await resource.get();
    await resource.close();
    assert.deepEqual(disposed, ["r"]);
  });

  test("close never throws, even when dispose does", async () => {
    const resource = new LazyResource(async () => "r", async () => {
      throw new Error("boom");
    });
    await resource.get();
    await resource.close();
  });

  test("closing something never opened is a no-op", async () => {
    let opens = 0;
    const resource = new LazyResource(async () => {
      opens += 1;
      return "r";
    }, async () => undefined);
    await resource.close();
    assert.equal(opens, 0);
  });

  test("after reset, the next call opens a fresh resource", async () => {
    let opens = 0;
    const resource = new LazyResource(async () => {
      opens += 1;
      return opens;
    }, async () => undefined);
    assert.equal(await resource.get(), 1);
    await resource.reset();
    assert.equal(await resource.get(), 2);
  });
});
