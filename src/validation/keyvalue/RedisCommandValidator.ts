import type { ValidationResult } from "../../types/validation.types.js";

/**
 * Decides whether a Redis command may run: an allowlist of read commands.
 *
 * Layer one for Redis, run before any connection is used. An allowlist rather
 * than a denylist because Redis has hundreds of commands, modules add more,
 * and an unrecognised one must be refused rather than assumed harmless.
 *
 * Layer two, in the driver, asks the server itself: COMMAND INFO reports
 * whether a command is flagged `write`, and the driver refuses any that is or
 * that is not flagged `readonly`. The two are independent, since one is a list
 * written here and the other is the server's own knowledge of its commands.
 *
 * Some read commands are left out on purpose:
 *
 * - KEYS blocks the server while it walks every key. SCAN is the answer.
 * - CONFIG GET returns `requirepass` and other secrets.
 * - PFCOUNT is flagged as a write, since it may update a cached cardinality.
 * - SORT can STORE its result; SORT_RO is the read form.
 * - Blocking reads (BLPOP, XREAD BLOCK, SUBSCRIBE) hold the connection.
 */
export class RedisCommandValidator {
  public static readonly ALLOWED = new Set([
    // Strings and generic key inspection
    "GET",
    "MGET",
    "STRLEN",
    "GETRANGE",
    "EXISTS",
    "TYPE",
    "TTL",
    "PTTL",
    "EXPIRETIME",
    "PEXPIRETIME",
    "SCAN",
    "RANDOMKEY",
    "DBSIZE",
    "SORT_RO",
    "LCS",
    // Hashes
    "HGET",
    "HMGET",
    "HGETALL",
    "HKEYS",
    "HVALS",
    "HLEN",
    "HEXISTS",
    "HSTRLEN",
    "HSCAN",
    "HRANDFIELD",
    "HTTL",
    "HPTTL",
    // Lists
    "LRANGE",
    "LLEN",
    "LINDEX",
    "LPOS",
    // Sets
    "SMEMBERS",
    "SCARD",
    "SISMEMBER",
    "SMISMEMBER",
    "SRANDMEMBER",
    "SSCAN",
    "SINTER",
    "SUNION",
    "SDIFF",
    "SINTERCARD",
    // Sorted sets
    "ZRANGE",
    "ZRANGEBYSCORE",
    "ZRANGEBYLEX",
    "ZREVRANGE",
    "ZREVRANGEBYSCORE",
    "ZREVRANGEBYLEX",
    "ZCARD",
    "ZSCORE",
    "ZMSCORE",
    "ZRANK",
    "ZREVRANK",
    "ZCOUNT",
    "ZLEXCOUNT",
    "ZSCAN",
    "ZRANDMEMBER",
    "ZINTER",
    "ZUNION",
    "ZDIFF",
    "ZINTERCARD",
    // Streams
    "XRANGE",
    "XREVRANGE",
    "XLEN",
    "XPENDING",
    // Bitmaps and geo
    "GETBIT",
    "BITCOUNT",
    "BITPOS",
    "BITFIELD_RO",
    "GEOPOS",
    "GEODIST",
    "GEOHASH",
    "GEOSEARCH",
    "GEORADIUS_RO",
    "GEORADIUSBYMEMBER_RO",
    // Server
    "INFO",
    "TIME",
    "PING",
    "ECHO",
    // RedisJSON, RediSearch and RedisTimeSeries read commands
    "JSON.GET",
    "JSON.MGET",
    "JSON.TYPE",
    "JSON.STRLEN",
    "JSON.OBJKEYS",
    "JSON.OBJLEN",
    "JSON.ARRLEN",
    "JSON.ARRINDEX",
    "FT.SEARCH",
    "FT.AGGREGATE",
    "FT.INFO",
    "FT._LIST",
    "TS.GET",
    "TS.MGET",
    "TS.RANGE",
    "TS.REVRANGE",
    "TS.MRANGE",
    "TS.MREVRANGE",
    "TS.INFO",
  ]);

  /**
   * Container commands whose subcommands differ in kind: `OBJECT ENCODING`
   * reads, while other subcommands of the same container may not. Only the
   * listed pairs are allowed.
   */
  public static readonly ALLOWED_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ["OBJECT", new Set(["ENCODING", "FREQ", "IDLETIME", "REFCOUNT"])],
    ["MEMORY", new Set(["USAGE"])],
    ["XINFO", new Set(["STREAM", "GROUPS", "CONSUMERS"])],
  ]);

  /** @returns the canonical upper-case name, or the reason it was refused. */
  public validate(command: string, args: readonly string[]): ValidationResult & { name?: string } {
    const name = command.trim().toUpperCase();
    if (!name) {
      return { valid: false, error: "Empty command." };
    }
    if (/\s/.test(name)) {
      return {
        valid: false,
        error: "Pass the command name alone and its arguments in args, e.g. command=HGET args=[\"user:1\", \"email\"].",
      };
    }

    const subcommands = RedisCommandValidator.ALLOWED_SUBCOMMANDS.get(name);
    if (subcommands) {
      const sub = (args[0] ?? "").toUpperCase();
      if (subcommands.has(sub)) {
        return { valid: true, name };
      }
      return {
        valid: false,
        error: `${name} ${sub || "(no subcommand)"} is not allowed. Allowed: ${Array.from(subcommands)
          .map((entry) => `${name} ${entry}`)
          .join(", ")}.`,
      };
    }

    if (name === "KEYS") {
      return {
        valid: false,
        error: "KEYS blocks the server while it scans every key. Use SCAN, or list_tables with a pattern.",
      };
    }

    if (!RedisCommandValidator.ALLOWED.has(name)) {
      return { valid: false, error: `${name} is not an allowed read-only command.` };
    }

    return { valid: true, name };
  }
}
