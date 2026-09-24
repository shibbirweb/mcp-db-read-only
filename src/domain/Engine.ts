/** Every engine this server can open. MariaDB and OpenSearch ride on two of them. */
export type Engine =
  | "mysql"
  | "postgres"
  | "sqlite"
  | "mssql"
  | "clickhouse"
  | "mongodb"
  | "redis"
  | "elasticsearch";

/**
 * How an engine is queried, which decides which query tools apply to it.
 *
 * The browse tools (list_tables, describe_table, ...) work on every family.
 * Each family then has its own query tool shape, because a SQL string, a
 * MongoDB pipeline and a Redis command have nothing in common worth unifying
 * behind one loosely typed argument.
 */
export type EngineFamily = "sql" | "document" | "keyvalue" | "search";

/** One accepted URL scheme and what it implies about the connection. */
export interface SchemeDescriptor {
  readonly name: string;
  /** 0 where the scheme has no port, as with SQLite files and SRV lookups. */
  readonly defaultPort: number;
  /** TLS for rediss, https for ClickHouse and Elasticsearch, SRV for MongoDB. */
  readonly secure: boolean;
}

export interface EngineDescriptor {
  readonly engine: Engine;
  readonly label: string;
  readonly family: EngineFamily;
  readonly schemes: readonly SchemeDescriptor[];
  /**
   * Whether use_database and the per-call `database` argument mean anything.
   * A SQLite file is its own database and an Elasticsearch cluster has none,
   * so for those two the honest answer is to refuse rather than pretend.
   */
  readonly switchesDatabases: boolean;
  /** Applied when a URL names no database, where the engine has a real default. */
  readonly defaultDatabase: string;
  /** What list_tables lists, so output says "Collections" on MongoDB. */
  readonly objectNoun: string;
  /** Whether a URL may name several hosts. Only MongoDB replica sets do. */
  readonly multipleHosts: boolean;
}

/**
 * Static facts about each engine, in one table.
 *
 * Kept as data rather than spread across the drivers, because the connection
 * layer needs these answers (which scheme is which engine, can it switch
 * databases) long before any driver exists, and must not load a driver module
 * to get them.
 */
export class EngineCatalog {
  private static readonly DESCRIPTORS: readonly EngineDescriptor[] = [
    {
      engine: "mysql",
      label: "MySQL",
      family: "sql",
      schemes: [
        { name: "mysql", defaultPort: 3306, secure: false },
        { name: "mariadb", defaultPort: 3306, secure: false },
      ],
      switchesDatabases: true,
      defaultDatabase: "",
      objectNoun: "table",
      multipleHosts: false,
    },
    {
      engine: "postgres",
      label: "PostgreSQL",
      family: "sql",
      schemes: [
        { name: "postgres", defaultPort: 5432, secure: false },
        { name: "postgresql", defaultPort: 5432, secure: false },
      ],
      switchesDatabases: true,
      defaultDatabase: "",
      objectNoun: "table",
      multipleHosts: false,
    },
    {
      engine: "sqlite",
      label: "SQLite",
      family: "sql",
      schemes: [{ name: "sqlite", defaultPort: 0, secure: false }],
      switchesDatabases: false,
      defaultDatabase: "",
      objectNoun: "table",
      multipleHosts: false,
    },
    {
      engine: "mssql",
      label: "SQL Server",
      family: "sql",
      schemes: [
        { name: "mssql", defaultPort: 1433, secure: false },
        { name: "sqlserver", defaultPort: 1433, secure: false },
      ],
      switchesDatabases: true,
      defaultDatabase: "",
      objectNoun: "table",
      multipleHosts: false,
    },
    {
      engine: "clickhouse",
      label: "ClickHouse",
      family: "sql",
      // The HTTP interface, which is what the official JavaScript client
      // speaks. The native protocol port 9000 is not what these point at.
      schemes: [
        { name: "clickhouse", defaultPort: 8123, secure: false },
        { name: "clickhouse+https", defaultPort: 8443, secure: true },
      ],
      switchesDatabases: true,
      defaultDatabase: "default",
      objectNoun: "table",
      multipleHosts: false,
    },
    {
      engine: "mongodb",
      label: "MongoDB",
      family: "document",
      schemes: [
        { name: "mongodb", defaultPort: 27017, secure: false },
        { name: "mongodb+srv", defaultPort: 0, secure: true },
      ],
      switchesDatabases: true,
      defaultDatabase: "",
      objectNoun: "collection",
      multipleHosts: true,
    },
    {
      engine: "redis",
      label: "Redis",
      family: "keyvalue",
      schemes: [
        { name: "redis", defaultPort: 6379, secure: false },
        { name: "rediss", defaultPort: 6379, secure: true },
      ],
      switchesDatabases: true,
      defaultDatabase: "0",
      objectNoun: "key",
      multipleHosts: false,
    },
    {
      engine: "elasticsearch",
      label: "Elasticsearch",
      family: "search",
      // OpenSearch answers the same read endpoints, so it shares the driver.
      schemes: [
        { name: "elasticsearch", defaultPort: 9200, secure: false },
        { name: "elasticsearch+https", defaultPort: 9200, secure: true },
        { name: "opensearch", defaultPort: 9200, secure: false },
        { name: "opensearch+https", defaultPort: 9200, secure: true },
      ],
      switchesDatabases: false,
      defaultDatabase: "",
      objectNoun: "index",
      multipleHosts: false,
    },
  ];

  public static all(): readonly EngineDescriptor[] {
    return EngineCatalog.DESCRIPTORS;
  }

  public static describe(engine: Engine): EngineDescriptor {
    const descriptor = EngineCatalog.DESCRIPTORS.find((entry) => entry.engine === engine);
    if (!descriptor) {
      throw new Error(`Unknown engine "${engine}".`);
    }
    return descriptor;
  }

  public static label(engine: Engine): string {
    return EngineCatalog.describe(engine).label;
  }

  /** @returns undefined for a scheme no engine claims. Case-insensitive. */
  public static findScheme(
    scheme: string
  ): { engine: EngineDescriptor; scheme: SchemeDescriptor } | undefined {
    const wanted = scheme.toLowerCase();
    for (const engine of EngineCatalog.DESCRIPTORS) {
      const match = engine.schemes.find((entry) => entry.name === wanted);
      if (match) {
        return { engine, scheme: match };
      }
    }
    return undefined;
  }

  /** @throws when the scheme is unknown, which a parsed target never has. */
  public static scheme(scheme: string): SchemeDescriptor {
    const found = EngineCatalog.findScheme(scheme);
    if (!found) {
      throw new Error(`Unknown scheme "${scheme}".`);
    }
    return found.scheme;
  }

  public static schemeNames(): string[] {
    return EngineCatalog.DESCRIPTORS.flatMap((engine) => engine.schemes.map((entry) => entry.name));
  }

  /** "MySQL, PostgreSQL, SQLite" for the engines of one family, for messages. */
  public static labelsFor(family: EngineFamily): string {
    return EngineCatalog.DESCRIPTORS.filter((engine) => engine.family === family)
      .map((engine) => engine.label)
      .join(", ");
  }
}
