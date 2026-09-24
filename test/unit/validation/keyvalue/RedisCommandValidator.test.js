import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RedisCommandValidator } from "../../../../dist/validation/keyvalue/RedisCommandValidator.js";

const validator = new RedisCommandValidator();

describe("read commands are allowed", () => {
  for (const command of ["GET", "hgetall", "LRANGE", "ZRANGE", "SCAN", "TTL", "INFO", "XRANGE", "JSON.GET", "FT.SEARCH"]) {
    test(command, () => {
      const result = validator.validate(command, []);
      assert.equal(result.valid, true);
      assert.equal(result.name, command.toUpperCase());
    });
  }
});

describe("write and dangerous commands are refused", () => {
  for (const command of ["SET", "DEL", "FLUSHALL", "FLUSHDB", "EVAL", "CONFIG", "SHUTDOWN", "SORT", "PFCOUNT", "BLPOP", "SUBSCRIBE", "CLIENT", "MONITOR", "DEBUG", "MODULE"]) {
    test(command, () => {
      assert.equal(validator.validate(command, []).valid, false);
    });
  }

  test("KEYS is refused with a pointer to SCAN", () => {
    assert.match(validator.validate("KEYS", ["*"]).error, /SCAN/);
  });
});

describe("container commands are allowed only for read subcommands", () => {
  test("OBJECT ENCODING is allowed", () => {
    assert.equal(validator.validate("OBJECT", ["encoding", "k"]).valid, true);
  });

  test("MEMORY USAGE is allowed, MEMORY PURGE is not", () => {
    assert.equal(validator.validate("MEMORY", ["USAGE", "k"]).valid, true);
    assert.equal(validator.validate("MEMORY", ["PURGE"]).valid, false);
  });

  test("XINFO STREAM is allowed, a missing subcommand is not", () => {
    assert.equal(validator.validate("XINFO", ["STREAM", "s"]).valid, true);
    assert.match(validator.validate("XINFO", []).error, /no subcommand/);
  });
});

describe("shape", () => {
  test("a whole command line in the command field is refused with the right form", () => {
    assert.match(validator.validate("GET mykey", []).error, /args/);
  });

  test("an empty command is refused", () => {
    assert.equal(validator.validate("  ", []).valid, false);
  });
});
