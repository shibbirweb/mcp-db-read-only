import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RowFormatter } from "../../../dist/formatting/RowFormatter.js";

const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: index }));

describe("truncation", () => {
  test("a small result is returned whole, with no note", () => {
    const text = new RowFormatter(5).format(rows(3), "Add a LIMIT clause");
    assert.equal(JSON.parse(text).length, 3);
  });

  test("a large result is cut at the cap and says so, with the true total", () => {
    const text = new RowFormatter(5).format(rows(12), "Add a LIMIT clause");
    assert.match(text, /Showing 5 of 12 rows\. Add a LIMIT clause for smaller results/);
    assert.equal(JSON.parse(text.split("\n\n---")[0]).length, 5);
  });

  test("a driver-capped result says there are more without claiming a total", () => {
    const text = new RowFormatter(5).format(rows(5), "Add a $limit stage", true);
    assert.match(text, /Showing the first 5 results; there are more/);
  });

  test("the default cap is 100", () => {
    assert.equal(new RowFormatter().limit, RowFormatter.DEFAULT_MAX_ROWS);
    assert.equal(RowFormatter.DEFAULT_MAX_ROWS, 100);
  });
});
