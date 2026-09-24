import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JsonSerializer } from "../../../dist/formatting/JsonSerializer.js";

const serializer = new JsonSerializer();
const roundTrip = (value) => JSON.parse(serializer.stringify(value));

describe("values plain JSON cannot handle", () => {
  test("a safe bigint becomes a number", () => {
    assert.deepEqual(roundTrip({ n: 42n }), { n: 42 });
  });

  test("an unsafe bigint becomes a string, keeping every digit", () => {
    assert.deepEqual(roundTrip({ n: 9007199254740993n }), { n: "9007199254740993" });
  });

  test("a Buffer is summarised instead of spelled out byte by byte", () => {
    const text = roundTrip({ blob: Buffer.from([1, 2, 255]) }).blob;
    assert.equal(text, "<binary 3 bytes: 0x0102ff>");
  });

  test("a long binary value shows a prefix and its full length", () => {
    const text = roundTrip({ blob: new Uint8Array(100) }).blob;
    assert.match(text, /^<binary 100 bytes: 0x0{64}\.\.\.>$/);
  });

  test("a Map becomes an object and a Set an array", () => {
    assert.deepEqual(roundTrip({ m: new Map([["a", 1]]), s: new Set([1, 2]) }), { m: { a: 1 }, s: [1, 2] });
  });

  test("dates keep their ISO form", () => {
    assert.deepEqual(roundTrip({ d: new Date("2026-01-02T03:04:05Z") }), { d: "2026-01-02T03:04:05.000Z" });
  });

  test("undefined at the top level is null rather than nothing", () => {
    assert.equal(serializer.stringify(undefined), "null");
  });
});
