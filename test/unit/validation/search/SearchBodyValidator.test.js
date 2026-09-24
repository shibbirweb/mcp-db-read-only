import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SearchBodyValidator } from "../../../../dist/validation/search/SearchBodyValidator.js";

const validator = new SearchBodyValidator();

describe("search bodies", () => {
  test("an ordinary query with aggregations passes", () => {
    const body = { query: { match: { title: "error" } }, size: 10, sort: [{ ts: "desc" }], aggs: { by: { terms: { field: "level" } } } };
    assert.equal(validator.validate(body).valid, true);
  });

  test("an empty body passes", () => {
    assert.equal(validator.validate({}).valid, true);
  });

  test("scroll and pit open server-side contexts and are refused", () => {
    assert.match(validator.validate({ scroll: "1m" }).error, /scroll/);
    assert.match(validator.validate({ pit: { id: "x" } }).error, /pit/);
  });

  test("every unknown key is named", () => {
    assert.match(validator.validate({ query: {}, script: {}, conflicts: "proceed" }).error, /keys: script, conflicts/);
  });
});
