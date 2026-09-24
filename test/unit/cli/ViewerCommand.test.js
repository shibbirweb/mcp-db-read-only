import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ViewerCommand } from "../../../dist/cli/ViewerCommand.js";

const parse = (args, env = {}) => new ViewerCommand({ out() {}, error() {} }, env).parse(args);

describe("parsing viewer arguments", () => {
  test("--dir and --port, with the folder made absolute", () => {
    const parsed = parse(["--dir", "logs", "--port", "4900"]);
    assert.equal(parsed.kind, "run");
    assert.ok(parsed.options.directory.startsWith("/") && parsed.options.directory.endsWith("/logs"));
    assert.equal(parsed.options.port, 4900);
    assert.equal(parsed.options.host, "0.0.0.0");
  });

  test("short and = forms", () => {
    assert.equal(parse(["-d", "/tmp/x", "-p", "5000"]).options.port, 5000);
    assert.equal(parse(["--dir=/tmp/x", "--port=5001", "--host=127.0.0.1"]).options.host, "127.0.0.1");
  });

  test("the port defaults to 4800", () => {
    assert.equal(parse(["--dir", "/tmp/x"]).options.port, 4800);
  });

  test("DB_LOG_DIR stands in for --dir", () => {
    assert.equal(parse([], { DB_LOG_DIR: "/var/log/db" }).options.directory, "/var/log/db");
  });

  test("a missing folder is a usage error naming the fix", () => {
    const parsed = parse([]);
    assert.equal(parsed.code, 2);
    assert.match(parsed.message, /--dir is required/);
  });

  test("a bad port and an unknown option are usage errors", () => {
    assert.match(parse(["--dir", "x", "--port", "http"]).message, /--port must be a number/);
    assert.match(parse(["--dir", "x", "--port", "70000"]).message, /--port must be a number/);
    assert.match(parse(["--verbose"]).message, /Unknown option "--verbose"/);
  });

  test("--help exits cleanly with the usage", () => {
    const parsed = parse(["--help"]);
    assert.equal(parsed.code, 0);
    assert.match(parsed.message, /^Usage: mcp-db-read-only viewer/);
  });
});
