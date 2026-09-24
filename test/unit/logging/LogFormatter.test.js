import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { JsonLogFormatter, PrettyLogFormatter } from "../../../dist/logging/LogFormatter.js";

const at = new Date("2026-09-25T10:14:03.221Z");
const call = {
  id: 3,
  tool: "run_query",
  pid: 72440,
  client: "claude-ai",
  at,
  durationMs: 38,
  connection: "dev (MySQL) mysql://root@127.0.0.1:3306/app",
  input: { query: "SELECT COUNT(*) AS n FROM members" },
  output: '[\n  {\n    "n": 17440\n  }\n]',
  failed: false,
  statements: [
    { pid: 72440, client: "claude-ai", engine: "MySQL", text: "SELECT COUNT(*) AS n FROM members", params: [1n, Buffer.from([1])], at, durationMs: 12, outcome: "1 row", failed: false },
  ],
};

describe("pretty", () => {
  const text = new PrettyLogFormatter().formatCall(call);

  test("opens with id, tool, status, duration and time", () => {
    assert.match(text, /^┌─ #3 run_query · ok · 38 ms · 2026-09-25T10:14:03\.221Z\n/);
  });

  test("shows the connection, input, statements and output under headings", () => {
    for (const heading of ["│ connection  dev (MySQL)", "│ process     claude-ai, pid 72440", "│ input", "│ statements (1)", "│ output"]) {
      assert.ok(text.includes(heading), heading);
    }
    assert.match(text, /│   1\. MySQL · 12 ms · 1 row\n│      SELECT COUNT\(\*\) AS n FROM members/);
  });

  test("every line of the output is indented inside the box", () => {
    const body = text.split("\n").slice(1, -2);
    assert.ok(body.every((line) => line.startsWith("│")), text);
    assert.ok(text.trimEnd().endsWith("└─"));
  });

  test("statement params use the safe serializer, so bigints and buffers do not throw", () => {
    assert.match(text, /params \[1,"<binary 1 bytes: 0x01>"\]/);
  });

  test("a failed call says FAILED and labels its output as the error", () => {
    const failed = new PrettyLogFormatter().formatCall({ ...call, failed: true, statements: [] });
    assert.match(failed, /· FAILED ·/);
    assert.match(failed, /│ error\n/);
    assert.ok(!failed.includes("statements ("), "no empty statements heading");
  });

  test("a stray statement is one short block", () => {
    const stray = new PrettyLogFormatter().formatStatement({ ...call.statements[0], params: undefined });
    assert.match(stray, /^· statement outside a tool call · MySQL · 12 ms · 1 row/);
  });
});

describe("json", () => {
  test("one parseable line per call, with every field", () => {
    const line = new JsonLogFormatter().formatCall(call);
    assert.equal(line.trimEnd().split("\n").length, 1);
    const parsed = JSON.parse(line);
    assert.equal(parsed.type, "call");
    assert.equal(parsed.tool, "run_query");
    assert.equal(parsed.at, "2026-09-25T10:14:03.221Z");
    assert.equal(parsed.statements[0].outcome, "1 row");
    assert.equal(parsed.output, call.output);
  });

  test("a stray statement is typed as such", () => {
    assert.equal(JSON.parse(new JsonLogFormatter().formatStatement(call.statements[0])).type, "statement");
  });
});
