import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MongoStageAllowlist } from "../../../../dist/drivers/document/MongoStageAllowlist.js";

const allowlist = new MongoStageAllowlist();

describe("stages", () => {
  test("read stages pass", () => {
    allowlist.assertAllowed([{ $match: {} }, { $group: { _id: null } }, { $sort: { a: 1 } }, { $limit: 5 }]);
  });

  test("$out and $merge are refused", () => {
    assert.throws(() => allowlist.assertAllowed([{ $out: "x" }]), /\$out is not allowed/);
    assert.throws(() => allowlist.assertAllowed([{ $merge: { into: "x" } }]), /\$merge is not allowed/);
  });

  // An allowlist refuses what it has never heard of, which is the point of
  // pairing it with the denylist in MongoOperatorGuard.
  test("an unknown stage is refused", () => {
    assert.throws(() => allowlist.assertAllowed([{ $someFutureWriteStage: {} }]), /not allowed/);
  });

  test("a stage must have exactly one operator", () => {
    assert.throws(() => allowlist.assertAllowed([{ $match: {}, $out: "x" }]), /exactly one/);
    assert.throws(() => allowlist.assertAllowed(["$match"]), /must be an object/);
  });
});

describe("nested pipelines", () => {
  test("$facet sub-pipelines are checked", () => {
    assert.throws(() => allowlist.assertAllowed([{ $facet: { a: [{ $match: {} }], b: [{ $merge: "x" }] } }]), /\$merge/);
  });

  test("a $lookup pipeline is checked", () => {
    assert.throws(
      () => allowlist.assertAllowed([{ $lookup: { from: "b", pipeline: [{ $out: "x" }], as: "j" } }]),
      /\$out/
    );
  });

  test("a $unionWith pipeline is checked", () => {
    assert.throws(() => allowlist.assertAllowed([{ $unionWith: { coll: "b", pipeline: [{ $merge: "x" }] } }]), /\$merge/);
  });

  test("a $unionWith naming only a collection is fine", () => {
    allowlist.assertAllowed([{ $unionWith: "other" }]);
  });
});
