import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MongoSchemaSampler } from "../../../../dist/drivers/document/MongoSchemaSampler.js";

const sampler = new MongoSchemaSampler();
const field = (fields, path) => fields.find((entry) => entry.path === path);

describe("inferring a shape from documents", () => {
  const fields = sampler.infer([
    { _id: { _bsontype: "ObjectId" }, name: "a", tags: ["x"], address: { city: "Dhaka" } },
    { _id: { _bsontype: "ObjectId" }, name: 7, created: new Date() },
  ]);

  test("reports every type a field was seen with", () => {
    assert.deepEqual(field(fields, "name").types, ["number", "string"]);
  });

  test("reports how often a field is present", () => {
    assert.equal(field(fields, "name").presentPercent, 100);
    assert.equal(field(fields, "address").presentPercent, 50);
  });

  test("names BSON types by their class", () => {
    assert.deepEqual(field(fields, "_id").types, ["ObjectId"]);
  });

  test("descends into sub-documents but not into BSON values", () => {
    assert.ok(field(fields, "address.city"));
    assert.equal(field(fields, "_id._bsontype"), undefined);
  });

  test("dates and arrays are named as such", () => {
    assert.deepEqual(field(fields, "created").types, ["date"]);
    assert.deepEqual(field(fields, "tags").types, ["array"]);
  });

  test("an empty collection has no fields", () => {
    assert.deepEqual(sampler.infer([]), []);
  });
});
