import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CallLogger } from "../../../dist/logging/CallLogger.js";
import { TextLogChannel } from "../../../dist/logging/LogChannel.js";
import { JsonLogFormatter } from "../../../dist/logging/LogFormatter.js";

/** Collects written entries, and can be told to fail. */
class MemorySink {
  constructor({ fail = false } = {}) {
    this.entries = [];
    this.fail = fail;
    this.description = "memory";
  }

  write(entry) {
    if (this.fail) {
      throw new Error("disk full");
    }
    this.entries.push(JSON.parse(entry));
  }
}

function build({ fail = false, connection = "dev (MySQL) mysql://reader@db:3306/app" } = {}) {
  const sink = new MemorySink({ fail });
  const warnings = [];
  const logger = new CallLogger([new TextLogChannel(sink, new JsonLogFormatter())], () => connection, (message) => warnings.push(message));
  return { sink, warnings, logger };
}

const ok = (text) => ({ content: [{ type: "text", text }] });
const failed = (text) => ({ content: [{ type: "text", text: `Error: ${text}` }], isError: true });

describe("a tool call", () => {
  test("is written once, with tool, redacted input, connection, output and duration", async () => {
    const { sink, logger } = build();
    await logger.observe("connect", { url: "mysql://u:pw@db/app", password: "pw" }, async () => ok("Connected"));

    assert.equal(sink.entries.length, 1);
    const [entry] = sink.entries;
    assert.equal(entry.type, "call");
    assert.equal(entry.tool, "connect");
    assert.deepEqual(entry.input, { url: "mysql://u:***@db/app", password: "***" });
    assert.equal(entry.connection, "dev (MySQL) mysql://reader@db:3306/app");
    assert.equal(entry.output, "Connected");
    assert.equal(entry.failed, false);
    assert.equal(typeof entry.durationMs, "number");
  });

  test("the full output is kept, however long", async () => {
    const { sink, logger } = build();
    const big = "x".repeat(100000);
    await logger.observe("run_query", {}, async () => ok(big));
    assert.equal(sink.entries[0].output.length, 100000);
  });

  test("an error result is marked failed", async () => {
    const { sink, logger } = build();
    await logger.observe("run_query", {}, async () => failed("Only SELECT ..."));
    assert.equal(sink.entries[0].failed, true);
  });

  test("the result reaches the caller unchanged", async () => {
    const { logger } = build();
    const result = ok("rows");
    assert.equal(await logger.observe("t", {}, async () => result), result);
  });

  test("ids increase call by call", async () => {
    const { sink, logger } = build();
    await logger.observe("a", {}, async () => ok(""));
    await logger.observe("b", {}, async () => ok(""));
    assert.deepEqual(sink.entries.map((entry) => entry.id), [1, 2]);
  });
});

describe("statements", () => {
  test("are nested under the call that sent them, however deep", async () => {
    const { sink, logger } = build();
    await logger.observe("describe_table", {}, async () => {
      await logger.trace("MySQL", { text: "SHOW COLUMNS FROM `t`" }, async () => [1, 2, 3]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await logger.trace("MySQL", { text: "SELECT 1", params: [7] }, async () => [1]);
      return ok("done");
    });

    assert.equal(sink.entries.length, 1, "statements must not be written separately");
    const statements = sink.entries[0].statements;
    assert.deepEqual(statements.map((statement) => statement.text), ["SHOW COLUMNS FROM `t`", "SELECT 1"]);
    assert.equal(statements[0].outcome, "3 rows");
    assert.equal(statements[1].outcome, "1 row");
    assert.deepEqual(statements[1].params, [7]);
  });

  test("concurrent calls each keep their own statements", async () => {
    const { sink, logger } = build();
    const call = (name, delay) =>
      logger.observe(name, {}, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        await logger.trace("Redis", { text: `GET ${name}` }, async () => "v");
        return ok("");
      });
    await Promise.all([call("first", 20), call("second", 1)]);

    for (const entry of sink.entries) {
      assert.deepEqual(entry.statements.map((statement) => statement.text), [`GET ${entry.tool}`]);
    }
  });

  test("a failed statement is recorded with its error and still throws", async () => {
    const { sink, logger } = build();
    await logger.observe("run_query", {}, async () => {
      await assert.rejects(() =>
        logger.trace("PostgreSQL", { text: "INSERT" }, async () => {
          throw new Error("read-only transaction");
        })
      );
      return failed("read-only transaction");
    });
    const [statement] = sink.entries[0].statements;
    assert.equal(statement.failed, true);
    assert.equal(statement.outcome, "read-only transaction");
  });

  test("a custom outcome description is used", async () => {
    const { sink, logger } = build();
    await logger.observe("t", {}, async () => {
      await logger.trace("Elasticsearch", { text: "GET /" }, async () => ({ status: 200 }), (r) => `HTTP ${r.status}`);
      return ok("");
    });
    assert.equal(sink.entries[0].statements[0].outcome, "HTTP 200");
  });

  test("outside any call, a statement is written as its own entry", async () => {
    const { sink, logger } = build();
    logger.record("MySQL", { text: "SET SESSION TRANSACTION READ ONLY" }, 3);
    assert.equal(sink.entries.length, 1);
    assert.equal(sink.entries[0].type, "statement");
    assert.equal(sink.entries[0].text, "SET SESSION TRANSACTION READ ONLY");
  });
});

describe("logging never breaks a call", () => {
  test("one failing channel is switched off while the others carry on", async () => {
    const good = new MemorySink();
    const bad = new MemorySink({ fail: true });
    const warnings = [];
    const logger = new CallLogger(
      [new TextLogChannel(bad, new JsonLogFormatter()), new TextLogChannel(good, new JsonLogFormatter())],
      () => null,
      (message) => warnings.push(message)
    );
    await logger.observe("a", {}, async () => ok(""));
    await logger.observe("b", {}, async () => ok(""));
    assert.deepEqual(good.entries.map((entry) => entry.tool), ["a", "b"]);
    assert.equal(warnings.length, 1);
  });

  test("a failing sink warns once, stops logging, and the call still succeeds", async () => {
    const { warnings, logger } = build({ fail: true });
    const first = await logger.observe("a", {}, async () => ok("one"));
    const second = await logger.observe("b", {}, async () => ok("two"));

    assert.equal(first.content[0].text, "one");
    assert.equal(second.content[0].text, "two");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /call logging to memory stopped.*disk full/);
  });

  test("a connection description that throws is logged as none", async () => {
    const sink = new MemorySink();
    const logger = new CallLogger([new TextLogChannel(sink, new JsonLogFormatter())], () => {
      throw new Error("boom");
    }, () => undefined);
    await logger.observe("t", {}, async () => ok(""));
    assert.equal(sink.entries[0].connection, null);
  });
});
