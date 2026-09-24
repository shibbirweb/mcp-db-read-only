import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RedisCommandFlagsGuard } from "../../../../dist/drivers/keyvalue/RedisCommandFlagsGuard.js";

/** COMMAND INFO as a real server answers it: [[name, arity, flags, ...]]. */
function fakeServer(flagsByCommand, { fail = false } = {}) {
  const calls = [];
  const call = async (...args) => {
    calls.push(args);
    if (fail) {
      throw new Error("NOPERM this user has no permissions to run the 'command' command");
    }
    const name = String(args[2]).toLowerCase();
    const flags = flagsByCommand[name];
    return flags ? [[name, 2, flags, 1, 1, 1]] : [null];
  };
  return { call, calls };
}

describe("the server decides", () => {
  test("a command flagged readonly is allowed", async () => {
    const { call } = fakeServer({ get: ["readonly", "fast"] });
    await new RedisCommandFlagsGuard().assertReadOnly(call, "GET");
  });

  // The whole point of a second, independent layer: even a command that got
  // onto the allowlist by mistake is refused if the server calls it a write.
  test("a command flagged write is refused", async () => {
    const { call } = fakeServer({ set: ["write", "denyoom"] });
    await assert.rejects(() => new RedisCommandFlagsGuard().assertReadOnly(call, "SET"), /does not flag SET as read-only/);
  });

  test("a command flagged both readonly and write is refused", async () => {
    const { call } = fakeServer({ odd: ["readonly", "write"] });
    await assert.rejects(() => new RedisCommandFlagsGuard().assertReadOnly(call, "ODD"));
  });

  test("a command with neither flag is refused", async () => {
    const { call } = fakeServer({ ping: ["fast"] });
    await assert.rejects(() => new RedisCommandFlagsGuard().assertReadOnly(call, "PING"));
  });

  test("an unknown command is refused", async () => {
    const { call } = fakeServer({});
    await assert.rejects(() => new RedisCommandFlagsGuard().assertReadOnly(call, "NOPE"), /does not know/);
  });
});

describe("failing closed", () => {
  test("when COMMAND itself is denied, the command is refused, not sent", async () => {
    const { call } = fakeServer({}, { fail: true });
    await assert.rejects(
      () => new RedisCommandFlagsGuard().assertReadOnly(call, "GET"),
      /Could not confirm GET is read-only because COMMAND INFO failed/
    );
  });
});

describe("subcommands and caching", () => {
  test("a container subcommand is looked up as container|sub", async () => {
    const { call, calls } = fakeServer({ "object|encoding": ["readonly"] });
    await new RedisCommandFlagsGuard().assertReadOnly(call, "OBJECT", "ENCODING");
    assert.deepEqual(calls[0], ["COMMAND", "INFO", "object|encoding"]);
  });

  test("an older server without subcommand info falls back to the container", async () => {
    const { call, calls } = fakeServer({ object: ["readonly"] });
    await new RedisCommandFlagsGuard().assertReadOnly(call, "OBJECT", "ENCODING");
    assert.deepEqual(calls[1], ["COMMAND", "INFO", "OBJECT"]);
  });

  test("the answer is cached per command", async () => {
    const { call, calls } = fakeServer({ get: ["readonly"] });
    const guard = new RedisCommandFlagsGuard();
    await guard.assertReadOnly(call, "GET");
    await guard.assertReadOnly(call, "GET");
    assert.equal(calls.length, 1);
  });
});
