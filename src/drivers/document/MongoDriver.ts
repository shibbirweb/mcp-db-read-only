import type { Document, MongoClient } from "mongodb";
import type { ConnectionTarget } from "../../domain/ConnectionTarget.js";
import { ObjectNotFoundError } from "../../errors/ObjectNotFoundError.js";
import type { DriverTuning } from "../../types/connection.types.js";
import type { StatementTracer } from "../../logging/StatementTracer.js";
import type { CappedRows, DatabaseEntry, FindRequest, ObjectListing } from "../../types/driver.types.js";
import { BaseDriver } from "../BaseDriver.js";
import type { DocumentDriver } from "../DatabaseDriver.js";
import { GlobPattern } from "../GlobPattern.js";
import { LazyResource } from "../LazyResource.js";
import { MongoSchemaSampler } from "./MongoSchemaSampler.js";
import { MongoStageAllowlist } from "./MongoStageAllowlist.js";

type MongoModule = typeof import("mongodb");

interface OpenedClient {
  readonly client: MongoClient;
  readonly bson: MongoModule["BSON"];
}

/**
 * MongoDB, through the official driver.
 *
 * Read-only layer two is structural. This class calls only read operations
 * (`find`, `aggregate`, `countDocuments`, `distinct`, the list commands and
 * `ping`) and never a generic command, so there is no method here through
 * which a write could be expressed. The one read operation that can write,
 * `aggregate` with `$out` or `$merge`, passes MongoStageAllowlist first.
 *
 * Filters and pipelines arrive as Extended JSON, so `{"$oid": "..."}` and
 * `{"$date": "..."}` work, and results go back the same way, so an ObjectId
 * survives the round trip into a follow-up filter.
 */
export class MongoDriver extends BaseDriver implements DocumentDriver {
  public readonly family = "document";

  private static readonly SYSTEM_DATABASES = new Set(["admin", "local", "config"]);
  private static readonly SCHEMA_SAMPLE_SIZE = 100;

  private readonly client: LazyResource<OpenedClient>;

  constructor(
    target: ConnectionTarget,
    private readonly tuning: DriverTuning,
    tracer: StatementTracer,
    private readonly stages: MongoStageAllowlist = new MongoStageAllowlist(),
    private readonly sampler: MongoSchemaSampler = new MongoSchemaSampler()
  ) {
    super(target, tracer);
    this.client = new LazyResource(
      () => this.open(),
      (opened) => opened.client.close()
    );
  }

  public async verify(): Promise<void> {
    const { client } = await this.client.get();
    const database = this.target.database || "admin";
    await this.traced(`${database}.ping`, undefined, () => client.db(database).command({ ping: 1 }), () => "ok");
  }

  public close(): Promise<void> {
    return this.client.close();
  }

  /**
   * `authorizedDatabases` so a user with access to a few databases sees those,
   * rather than an authorisation error for not being allowed to see them all.
   */
  public async listDatabases(): Promise<DatabaseEntry[]> {
    const { client } = await this.client.get();
    const result = await this.traced(
      "admin.listDatabases",
      { nameOnly: true, authorizedDatabases: true },
      () => client.db("admin").admin().listDatabases({ nameOnly: true, authorizedDatabases: true }),
      (answer) => `${answer.databases.length} databases`
    );
    return result.databases.map((entry) => ({
      name: entry.name,
      system: MongoDriver.SYSTEM_DATABASES.has(entry.name),
    }));
  }

  public async listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing> {
    const database = await this.database();
    const collections = await this.traced(`${database.databaseName}.listCollections`, undefined, () =>
      database.listCollections({}, { nameOnly: true, authorizedCollections: true }).toArray()
    );
    return new GlobPattern(pattern).apply(
      collections.map((entry) => entry.name).sort(),
      limit
    );
  }

  /** The inferred shape of a sample, plus any JSON Schema validator the collection declares. */
  public async describeObject(name: string): Promise<unknown> {
    const database = await this.database();
    const [info] = await this.traced(`${database.databaseName}.listCollections`, { name }, () =>
      database.listCollections({ name }).toArray()
    );
    if (!info) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }

    const sampling = [{ $sample: { size: MongoDriver.SCHEMA_SAMPLE_SIZE } }];
    const documents = await this.traced(`${database.databaseName}.${name}.aggregate`, sampling, () =>
      database.collection(name).aggregate(sampling, { maxTimeMS: this.tuning.queryTimeoutMs }).toArray()
    );

    return {
      collection: name,
      sampled_documents: documents.length,
      fields: this.sampler.infer(documents),
      validator: (info as { options?: { validator?: unknown } }).options?.validator ?? null,
    };
  }

  public async listIndexes(name: string): Promise<unknown> {
    await this.assertCollection(name);
    const database = await this.database();
    return this.traced(`${database.databaseName}.${name}.indexes`, undefined, () => database.collection(name).indexes());
  }

  public async sample(name: string, limit: number): Promise<unknown> {
    await this.assertCollection(name);
    return this.find(name, { filter: {}, limit, skip: 0 });
  }

  public async find(collection: string, request: FindRequest): Promise<unknown[]> {
    const { bson } = await this.client.get();
    const database = await this.database();
    const cursor = database.collection(collection).find(this.fromJson(bson, request.filter), {
      projection: request.projection ? this.fromJson(bson, request.projection) : undefined,
      sort: request.sort ? (this.fromJson(bson, request.sort) as Document) : undefined,
      limit: request.limit,
      skip: request.skip,
      maxTimeMS: this.tuning.queryTimeoutMs,
    });
    const documents = await this.traced(`${database.databaseName}.${collection}.find`, request, () => cursor.toArray());
    return this.toJson(bson, documents);
  }

  /**
   * Reads at most `limit + 1` documents and closes the cursor, so a pipeline
   * matching millions of documents costs one batch, and the extra document
   * says whether there were more.
   */
  public async aggregate(
    collection: string,
    pipeline: Record<string, unknown>[],
    limit: number
  ): Promise<CappedRows> {
    this.stages.assertAllowed(pipeline);

    const { bson } = await this.client.get();
    const database = await this.database();
    const cursor = database.collection(collection).aggregate(pipeline.map((stage) => this.fromJson(bson, stage)), {
      maxTimeMS: this.tuning.queryTimeoutMs,
      allowDiskUse: false,
      batchSize: limit + 1,
    });

    const rows: Document[] = [];
    await this.traced(`${database.databaseName}.${collection}.aggregate`, pipeline, async () => {
      try {
        for await (const document of cursor) {
          rows.push(document);
          if (rows.length > limit) {
            break;
          }
        }
      } finally {
        await cursor.close();
      }
      return rows;
    });

    return { rows: this.toJson(bson, rows.slice(0, limit)), truncated: rows.length > limit };
  }

  public async count(collection: string, filter: Record<string, unknown>): Promise<number> {
    const { bson } = await this.client.get();
    const database = await this.database();
    return this.traced(`${database.databaseName}.${collection}.countDocuments`, filter, () =>
      database.collection(collection).countDocuments(this.fromJson(bson, filter), { maxTimeMS: this.tuning.queryTimeoutMs })
    );
  }

  public async distinct(
    collection: string,
    field: string,
    filter: Record<string, unknown>
  ): Promise<unknown[]> {
    const { bson } = await this.client.get();
    const database = await this.database();
    const values = await this.traced(`${database.databaseName}.${collection}.distinct`, { field, filter }, () =>
      database.collection(collection).distinct(field, this.fromJson(bson, filter), { maxTimeMS: this.tuning.queryTimeoutMs })
    );
    return this.toJson(bson, values);
  }

  private async database() {
    const { client } = await this.client.get();
    return client.db(this.requireDatabase());
  }

  private async assertCollection(name: string): Promise<void> {
    const database = await this.database();
    const found = await this.traced(`${database.databaseName}.listCollections`, { name }, () =>
      database.listCollections({ name }, { nameOnly: true }).toArray()
    );
    if (found.length === 0) {
      throw new ObjectNotFoundError(this.objectNoun, name);
    }
  }

  /** Extended JSON in: `{"$oid": ...}` becomes an ObjectId the server can match. */
  private fromJson(bson: MongoModule["BSON"], value: Record<string, unknown>): Document {
    return bson.EJSON.deserialize(value as Document, { relaxed: true }) as Document;
  }

  /** Relaxed Extended JSON out: numbers stay numbers, and ObjectIds stay recognisable. */
  private toJson(bson: MongoModule["BSON"], values: unknown[]): unknown[] {
    return values.map((value) => bson.EJSON.serialize(value, { relaxed: true }));
  }

  /**
   * The URL is rebuilt without credentials, which go through `auth` instead,
   * so a password containing URL syntax never has to survive a round trip
   * through encoding. Imported on first use; see MySqlDriver.createPool.
   */
  private async open(): Promise<OpenedClient> {
    const mongodb = (await import("mongodb")) as MongoModule;

    const hosts = this.target.hosts
      .map((entry) => (entry.port > 0 ? `${entry.host}:${entry.port}` : entry.host))
      .join(",");
    const query = new URLSearchParams({ ...this.target.options, ...this.target.secretOptions }).toString();
    const url = `${this.target.scheme}://${hosts}/${query ? `?${query}` : ""}`;

    const client = new mongodb.MongoClient(url, {
      auth: this.target.user ? { username: this.target.user, password: this.target.password } : undefined,
      // The database named in the URL is also where credentials are checked,
      // unless authSource says otherwise, which is what a MongoDB URL means.
      authSource: this.target.option("authSource") ?? (this.target.database || undefined),
      appName: "mcp-db-read-only",
      maxPoolSize: this.tuning.connectionLimit,
      connectTimeoutMS: this.tuning.connectTimeoutMs,
      serverSelectionTimeoutMS: this.tuning.connectTimeoutMs,
    });

    await client.connect();
    return { client, bson: mongodb.BSON };
  }
}
