import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PackageVersionLoader } from "../../../dist/config/PackageVersionLoader.js";

/**
 * The URL is a constructor argument, so a case is just a file on disk. The
 * default points at the real package.json, which is covered by its own case
 * below rather than by every other one.
 */
const loadFrom = (contents) => {
  const file = join(mkdtempSync(join(tmpdir(), "mcp-version-")), "package.json");
  writeFileSync(file, contents);
  return new PackageVersionLoader(pathToFileURL(file)).load();
};

describe("reading the version", () => {
  test("returns the version from package.json", () => {
    assert.equal(loadFrom(JSON.stringify({ version: "2.3.4" })), "2.3.4");
  });

  test("reads the real package.json by default", () => {
    // Asserts the shape rather than a number, so a release does not break it.
    assert.match(new PackageVersionLoader().load(), /^\d+\.\d+\.\d+/);
  });
});

describe("falling back", () => {
  // A server that starts and reports 0.0.0 can still answer queries and can be
  // diagnosed from its own output. One that refuses to start over metadata
  // reports "server failed to start", which says nothing.
  test("missing file falls back rather than throwing", () => {
    const missing = pathToFileURL(join(tmpdir(), "mcp-version-does-not-exist", "package.json"));
    assert.equal(new PackageVersionLoader(missing).load(), PackageVersionLoader.UNKNOWN_VERSION);
  });

  test("unreadable JSON falls back", () => {
    assert.equal(loadFrom("{ not json"), PackageVersionLoader.UNKNOWN_VERSION);
  });

  test("a package.json without a version falls back", () => {
    assert.equal(loadFrom(JSON.stringify({ name: "x" })), PackageVersionLoader.UNKNOWN_VERSION);
  });

  test("a non-string version falls back", () => {
    assert.equal(loadFrom(JSON.stringify({ version: 2 })), PackageVersionLoader.UNKNOWN_VERSION);
  });
});
