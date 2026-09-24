import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { EngineCatalog } from "../../domain/Engine.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import { UnsupportedOperationError } from "../../errors/UnsupportedOperationError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { DatabaseEntry, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { SearchDriver } from "../DatabaseDriver.js";

/**
 * Every request this driver can make, as a closed union.
 *
 * This is read-only layer two for search engines: the class has no generic
 * "send a request" method, only these. Each GET is to a fixed read endpoint,
 * and the only POST is to `_search`, which cannot write. Paths are built here
 * from an index name that has already passed ElasticNamePolicy, so no caller
 * can steer a request at `_delete_by_query`, `_bulk` or any other endpoint.
 */
type ReadRequest =
  | { readonly kind: "cluster" }
  | { readonly kind: "indices"; readonly pattern: string }
  | { readonly kind: "mapping"; readonly index: string }
  | { readonly kind: "search"; readonly index: string; readonly body: Record<string, unknown> };

interface SearchHit {
  readonly _index: string;
  readonly _id: string;
  readonly _score: number | null;
  readonly _source?: unknown;
  readonly fields?: unknown;
  readonly highlight?: unknown;
  readonly sort?: unknown;
}

/**
 * Elasticsearch and OpenSearch, over their REST API with Node's own fetch.
 *
 * No client library, for two reasons. The official Elasticsearch client
 * refuses to talk to OpenSearch, and the OpenSearch client to Elasticsearch,
 * so supporting both would take two dependencies. And the five read calls
 * needed here are simple enough that a client would add weight without
 * adding safety; the closed ReadRequest union is the safety.
 *
 * Authentication is basic auth from the URL's user and password, or an API
 * key from `?api_key=`, which is kept out of every displayed string.
 */
export class ElasticsearchDriver extends BaseDriver implements SearchDriver {
  public readonly family = "search";

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning,
    // Wrapped so fetch is never invoked with this driver as its receiver.
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)
  ) {
    super(target);
  }

  public async verify(): Promise<void> {
    const cluster = (await this.send({ kind: "cluster" }, this.tuning.connectTimeoutMs)) as {
      version?: { number?: string };
    };
    if (!cluster.version?.number) {
      throw new Error("The server answered, but not as Elasticsearch or OpenSearch.");
    }
  }

  /** Nothing to release: fetch holds no connection between calls that we own. */
  public async close(): Promise<void> {
    return;
  }

  public async listDatabases(): Promise<DatabaseEntry[]> {
    throw new UnsupportedOperationError(this.label, "databases", "Its indices are listed by list_tables.");
  }

  /**
   * Indices whose names start with `.` are internal (security, Kibana,
   * ingest state) and are hidden unless the pattern asks for them.
   */
  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const rows = (await this.send({ kind: "indices", pattern: pattern || "*" })) as { index: string }[];
    const showHidden = (pattern ?? "").startsWith(".");
    const names = rows
      .map((row) => row.index)
      .filter((name) => showHidden || !name.startsWith("."))
      .sort();
    return { names: names.slice(0, limit), truncated: names.length > limit };
  }

  public async describeObject(name: string): Promise<unknown> {
    return this.send({ kind: "mapping", index: name });
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    const result = (await this.search(name, { size: limit })) as { hits: unknown[] };
    return result.hits;
  }

  /** Hits trimmed to what a reader needs, with the total reported alongside. */
  public async search(index: string, body: Record<string, unknown>): Promise<unknown> {
    const result = (await this.send({ kind: "search", index, body })) as {
      took?: number;
      timed_out?: boolean;
      hits?: { total?: unknown; hits?: SearchHit[] };
      aggregations?: unknown;
      suggest?: unknown;
    };
    return {
      took_ms: result.took,
      timed_out: result.timed_out,
      total: result.hits?.total,
      hits: (result.hits?.hits ?? []).map((hit) => ({
        _index: hit._index,
        _id: hit._id,
        _score: hit._score,
        _source: hit._source,
        fields: hit.fields,
        highlight: hit.highlight,
        sort: hit.sort,
      })),
      aggregations: result.aggregations,
      suggest: result.suggest,
    };
  }

  private async send(request: ReadRequest, timeoutMs = this.tuning.queryTimeoutMs): Promise<unknown> {
    const { method, path, body } = this.route(request);
    const response = await this.fetcher(`${this.baseUrl()}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    const parsed = text ? this.parse(text) : null;

    if (response.status === 404 && request.kind !== "cluster" && request.kind !== "indices") {
      throw new ObjectNotFoundError(this.objectNoun, request.index);
    }
    if (!response.ok) {
      throw new Error(`${this.label} answered ${response.status}: ${this.reason(parsed, text)}`);
    }
    return parsed;
  }

  /**
   * The only place a path is built. Index names are percent-encoded on top of
   * having passed the name policy, which already refused `.`, `..` and a
   * leading `_`.
   */
  private route(request: ReadRequest): { method: "GET" | "POST"; path: string; body?: unknown } {
    switch (request.kind) {
      case "cluster":
        return { method: "GET", path: "/" };
      case "indices":
        return {
          method: "GET",
          path: `/_cat/indices/${this.segment(request.pattern)}?format=json&h=index&expand_wildcards=open`,
        };
      case "mapping":
        return { method: "GET", path: `/${this.segment(request.index)}/_mapping` };
      case "search":
        return { method: "POST", path: `/${this.segment(request.index)}/_search`, body: request.body };
    }
  }

  /** Commas and wildcards are meaningful in an index expression, so they are kept. */
  private segment(value: string): string {
    return encodeURIComponent(value).replace(/%2C/gi, ",").replace(/%2A/gi, "*");
  }

  private baseUrl(): string {
    const secure = EngineCatalog.scheme(this.target.scheme).secure;
    const host = this.target.host.includes(":") ? `[${this.target.host}]` : this.target.host;
    return `${secure ? "https" : "http"}://${host}:${this.target.port}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    const apiKey = this.target.secretOption("api_key") ?? this.target.secretOption("apikey");
    if (apiKey) {
      headers.authorization = `ApiKey ${apiKey}`;
    } else if (this.target.user) {
      const credentials = Buffer.from(`${this.target.user}:${this.target.password}`).toString("base64");
      headers.authorization = `Basic ${credentials}`;
    }
    return headers;
  }

  private parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Elasticsearch errors carry `error.root_cause[0].reason`; the first useful one wins. */
  private reason(parsed: unknown, text: string): string {
    const error = (parsed as { error?: { reason?: string; type?: string } | string } | null)?.error;
    if (typeof error === "string") {
      return error;
    }
    if (error?.reason) {
      return error.type ? `${error.type}: ${error.reason}` : error.reason;
    }
    return text.slice(0, 500);
  }
}
