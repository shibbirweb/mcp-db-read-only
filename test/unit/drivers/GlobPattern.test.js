import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { GlobPattern } from "../../../dist/drivers/GlobPattern.js";

describe("glob matching", () => {
  test("no pattern matches everything", () => {
    assert.ok(new GlobPattern(undefined).matches("anything"));
  });

  test("* and ? behave as in a shell", () => {
    const pattern = new GlobPattern("user_?_*");
    assert.ok(pattern.matches("user_a_events"));
    assert.ok(!pattern.matches("user_ab_events"));
  });

  test("matching ignores case", () => {
    assert.ok(new GlobPattern("Orders*").matches("orders_2026"));
  });

  test("regular expression characters are literal", () => {
    assert.ok(new GlobPattern("a.b").matches("a.b"));
    assert.ok(!new GlobPattern("a.b").matches("axb"));
    assert.ok(new GlobPattern("(x)+").matches("(x)+"));
  });

  test("apply filters, caps, and reports truncation", () => {
    const listing = new GlobPattern("t*").apply(["t1", "t2", "t3", "other"], 2);
    assert.deepEqual(listing, { names: ["t1", "t2"], truncated: true });
  });
});
