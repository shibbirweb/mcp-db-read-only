import type { Redis } from "ioredis";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { StatementTracer } from "../../logging/StatementTracer.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { KeyValueDriver } from "../DatabaseDriver.js";
import { LazyResource } from "../LazyResource.js";
import { RedisCommandFlagsGuard } from "./RedisCommandFlagsGuard.js";

/**
 * Redis, and anything speaking its protocol (Valkey, KeyDB, Dragonfly),
 * through ioredis.
 *
 * Keys stand in for tables: list_tables scans keys, describe_table reports a
 * key's type, TTL and size, and get_table_sample reads a bounded slice of its
 * value. Every one of those uses a fixed read command chosen here.
 *
 * Read-only layer two applies to redis_command, the only path where the
 * caller chooses the command: RedisCommandFlagsGuard asks the server to
 * confirm the command is flagged read-only before it is sent.
 */
export class RedisDriver extends BaseDriver implements KeyValueDriver {
  public readonly family = "keyvalue";

  /** How many keys one SCAN step asks for. A hint to Redis, not a limit. */
  private static readonly SCAN_BATCH = 500;

  /** Long strings are cut in samples; the length is reported so nothing is hidden silently. */
  private static readonly MAX_STRING_PREVIEW = 4096;

  private readonly client: LazyResource<Redis>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning,
    tracer: StatementTracer,
    private readonly logger: (message: string) => void,
    private readonly guard: RedisCommandFlagsGuard = new RedisCommandFlagsGuard()
  ) {
    super(target, tracer);
    this.client = new LazyResource(
      () => this.open(),
      async (client) => {
        client.disconnect();
      }
    );
  }

  public async verify(): Promise<void> {
    await this.call("PING");
  }

  public close(): Promise<void> {
    return this.client.close();
  }

  /**
   * INFO keyspace lists only databases holding keys, which is what someone
   * browsing wants; the active one is always included even when empty.
   */
  public async listDatabases(): Promise<DatabaseEntry[]> {
    const info = String(await this.call("INFO", "keyspace"));
    const names = new Set<string>();
    for (const match of info.matchAll(/^db(\d+):/gm)) {
      names.add(match[1]);
    }
    names.add(this.databaseIndex().toString());
    return Array.from(names)
      .sort((a, b) => Number(a) - Number(b))
      .map((name) => ({ name, system: false }));
  }

  /**
   * SCAN, never KEYS: KEYS blocks the whole server while it walks every key,
   * which on a production instance is an outage.
   */
  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const found: string[] = [];
    let cursor = "0";

    do {
      const [next, keys] = (await this.call(
        "SCAN",
        cursor,
        "MATCH",
        pattern || "*",
        "COUNT",
        String(RedisDriver.SCAN_BATCH)
      )) as [string, string[]];
      cursor = next;
      found.push(...keys);
    } while (cursor !== "0" && found.length <= limit);

    const unique = Array.from(new Set(found)).sort();
    return { names: unique.slice(0, limit), truncated: unique.length > limit || cursor !== "0" };
  }

  public async describeObject(name: string): Promise<unknown> {
    const type = await this.typeOf(name);
    const [ttl, length, encoding, memory] = await Promise.all([
      this.call("TTL", name),
      this.lengthOf(name, type),
      this.optional(() => this.call("OBJECT", "ENCODING", name)),
      this.optional(() => this.call("MEMORY", "USAGE", name)),
    ]);

    return {
      key: name,
      type,
      // -1 means the key never expires, which reads better said than shown.
      ttl_seconds: ttl === -1 ? "no expiry" : ttl,
      length,
      encoding,
      memory_bytes: memory,
    };
  }

  /** A bounded slice of the value, read with the command that fits its type. */
  public async sample(name: string, limit: number): Promise<unknown> {
    const type = await this.typeOf(name);
    const last = String(limit - 1);

    switch (type) {
      case "string":
        return this.previewString(String(await this.call("GET", name)));
      case "hash":
        return this.pairs((await this.call("HSCAN", name, "0", "COUNT", String(limit))) as [string, string[]], limit);
      case "list":
        return this.call("LRANGE", name, "0", last);
      case "set":
        return ((await this.call("SSCAN", name, "0", "COUNT", String(limit))) as [string, string[]])[1].slice(0, limit);
      case "zset":
        return this.scored((await this.call("ZRANGE", name, "0", last, "WITHSCORES")) as string[]);
      case "stream":
        return this.call("XRANGE", name, "-", "+", "COUNT", String(limit));
      case "ReJSON-RL":
        return JSON.parse(String(await this.call("JSON.GET", name)));
      default:
        return { key: name, type, note: "No sample reader for this type; use redis_command." };
    }
  }

  /**
   * The guard's COMMAND INFO lookups go through `call` too, so the log shows
   * the server being asked before the command itself is sent.
   */
  public async command(name: string, args: readonly string[]): Promise<unknown> {
    const call = (command: string, ...rest: string[]) => this.call(command, ...rest);
    const subcommand = this.isContainer(name) ? args[0]?.toUpperCase() : undefined;

    await this.guard.assertReadOnly(call, name, subcommand);
    return call(name, ...args);
  }

  private async typeOf(name: string): Promise<string> {
    const type = String(await this.call("TYPE", name));
    if (type === "none") {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
    return type;
  }

  private async lengthOf(name: string, type: string): Promise<unknown> {
    const command: Record<string, string> = {
      string: "STRLEN",
      hash: "HLEN",
      list: "LLEN",
      set: "SCARD",
      zset: "ZCARD",
      stream: "XLEN",
    };
    return command[type] ? this.call(command[type], name) : null;
  }

  /** OBJECT and MEMORY are often denied by ACLs or missing on compatible servers. */
  private async optional(read: () => Promise<unknown>): Promise<unknown> {
    try {
      return await read();
    } catch {
      return null;
    }
  }

  private previewString(value: string): unknown {
    if (value.length <= RedisDriver.MAX_STRING_PREVIEW) {
      return value;
    }
    return {
      preview: value.slice(0, RedisDriver.MAX_STRING_PREVIEW),
      total_length: value.length,
    };
  }

  private pairs(reply: [string, string[]], limit: number): Record<string, string> {
    const flat = reply[1];
    const out: Record<string, string> = {};
    for (let index = 0; index + 1 < flat.length && Object.keys(out).length < limit; index += 2) {
      out[flat[index]] = flat[index + 1];
    }
    return out;
  }

  private scored(flat: string[]): { member: string; score: number }[] {
    const out: { member: string; score: number }[] = [];
    for (let index = 0; index + 1 < flat.length; index += 2) {
      out.push({ member: flat[index], score: Number(flat[index + 1]) });
    }
    return out;
  }

  private isContainer(name: string): boolean {
    return ["OBJECT", "MEMORY", "XINFO"].includes(name);
  }

  /** Every command this driver sends passes through here, so every one is traced. */
  private async call(command: string, ...args: string[]): Promise<unknown> {
    const client = await this.client.get();
    return this.traced([command, ...args].join(" "), undefined, () => client.call(command, ...args), RedisDriver.describeReply);
  }

  /** Arrays by length, short scalars by value, so `GET` and `DBSIZE` read naturally in the log. */
  private static describeReply(reply: unknown): string {
    if (Array.isArray(reply)) {
      return `${reply.length} item${reply.length === 1 ? "" : "s"}`;
    }
    if (reply === null) {
      return "nil";
    }
    const text = String(reply);
    return text.length <= 40 ? text : `${text.length} characters`;
  }

  private databaseIndex(): number {
    const parsed = Number.parseInt(this.target.database, 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  /** Imported on first use; see MySqlDriver.createPool. */
  private async open(): Promise<Redis> {
    const { Redis: RedisClient } = await import("ioredis");
    const secure = EngineCatalog.scheme(this.target.scheme).secure;

    // Reconnect only once a connection has worked. With lazyConnect, ioredis
    // retries a refused first connection forever and connect() never settles,
    // so connecting to a Redis that is down hung the tool call instead of
    // failing it. Found when the integration probe hung on a missing server.
    let everConnected = false;

    const client = new RedisClient({
      host: this.target.host,
      port: this.target.port,
      username: this.target.user || undefined,
      password: this.target.password || undefined,
      db: this.databaseIndex(),
      tls: secure ? {} : undefined,
      connectTimeout: this.tuning.connectTimeoutMs,
      commandTimeout: this.tuning.queryTimeoutMs,
      lazyConnect: true,
      // Fail a command promptly while disconnected rather than queueing it
      // until the server returns, which from a conversation looks like a hang.
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt: number) => (everConnected ? Math.min(attempt * 200, 2000) : null),
      connectionName: "mcp-db-read-only",
    });
    client.once("ready", () => {
      everConnected = true;
    });

    // ioredis emits connection errors as events; unlistened, they are printed
    // by the library itself. Routed through the logger they stay on stderr
    // and carry this server's prefix.
    client.on("error", (error: Error) => this.logger(`redis: ${error.message}`));

    try {
      await client.connect();
    } catch (error) {
      client.disconnect();
      throw error;
    }
    return client;
  }
}
