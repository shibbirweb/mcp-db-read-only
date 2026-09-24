import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MongoOperatorGuard } from "../../../../dist/validation/document/MongoOperatorGuard.js";

const guard = new MongoOperatorGuard();
const check = (value) => guard.validate(value, "pipeline");

describe("forbidden operators are found at any depth", () => {
  test("$out as a top-level stage", () => {
    assert.match(check([{ $match: {} }, { $out: "copy" }]).error, /\$out writes/);
  });

  test("$merge inside $facet", () => {
    assert.match(check([{ $facet: { a: [{ $merge: { into: "x" } }] } }]).error, /\$merge/);
  });

  test("$merge inside a $lookup pipeline", () => {
    const pipeline = [{ $lookup: { from: "b", pipeline: [{ $merge: "x" }], as: "joined" } }];
    assert.equal(check(pipeline).valid, false);
  });

  test("$where in a filter", () => {
    assert.match(guard.validate({ $where: "sleep(100000)" }, "filter").error, /JavaScript/);
  });

  test("$function inside $expr", () => {
    const filter = { $expr: { $function: { body: "function() {}", args: [], lang: "js" } } };
    assert.equal(guard.validate(filter, "filter").valid, false);
  });

  test("$accumulator inside $group", () => {
    assert.equal(check([{ $group: { _id: null, x: { $accumulator: {} } } }]).valid, false);
  });

  test("$changeStream", () => {
    assert.equal(check([{ $changeStream: {} }]).valid, false);
  });
});

describe("ordinary reads pass", () => {
  test("a typical pipeline", () => {
    const pipeline = [
      { $match: { status: "active", age: { $gte: 18 } } },
      { $group: { _id: "$country", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 10 },
    ];
    assert.equal(check(pipeline).valid, true);
  });

  test("a value that merely contains the text $out is data", () => {
    assert.equal(guard.validate({ note: "$out of stock" }, "filter").valid, true);
  });
});

describe("hostile shapes", () => {
  test("absurd nesting is refused rather than recursed into", () => {
    let deep = {};
    for (let i = 0; i < 200; i += 1) {
      deep = { a: deep };
    }
    assert.match(guard.validate(deep, "filter").error, /nested too deeply/);
  });
});
