import { EnvironmentConfigLoader } from "./config/EnvironmentConfigLoader.js";
import { PackageVersionLoader } from "./config/PackageVersionLoader.js";
import { ConnectionManager } from "./connections/ConnectionManager.js";
import { ConnectionRegistry } from "./connections/ConnectionRegistry.js";
import { ConnectionTargetFactory } from "./connections/ConnectionTargetFactory.js";
import { EngineCatalog } from "./domain/Engine.js";
import { MongoDriver } from "./drivers/document/MongoDriver.js";
import { DriverCache } from "./drivers/DriverCache.js";
import { DriverProvider } from "./drivers/DriverProvider.js";
import { DriverRegistry } from "./drivers/DriverRegistry.js";
import { RedisDriver } from "./drivers/keyvalue/RedisDriver.js";
import { ElasticsearchDriver } from "./drivers/search/ElasticsearchDriver.js";
import { ClickHouseDriver } from "./drivers/sql/ClickHouseDriver.js";
import { MsSqlDriver } from "./drivers/sql/MsSqlDriver.js";
import { MySqlDriver } from "./drivers/sql/MySqlDriver.js";
import { PostgresDriver } from "./drivers/sql/PostgresDriver.js";
import { SqliteDriver } from "./drivers/sql/SqliteDriver.js";
import { RowFormatter } from "./formatting/RowFormatter.js";
import { McpDbServer } from "./server/McpDbServer.js";
import { BaseTool } from "./tools/BaseTool.js";
import { DescribeTableTool } from "./tools/browse/DescribeTableTool.js";
import { GetForeignKeysTool } from "./tools/browse/GetForeignKeysTool.js";
import { GetTableIndexesTool } from "./tools/browse/GetTableIndexesTool.js";
import { GetTableSampleTool } from "./tools/browse/GetTableSampleTool.js";
import { ListTablesTool } from "./tools/browse/ListTablesTool.js";
import { ConnectTool } from "./tools/connection/ConnectTool.js";
import { CurrentConnectionTool } from "./tools/connection/CurrentConnectionTool.js";
import { ListConnectionsTool } from "./tools/connection/ListConnectionsTool.js";
import { ListDatabasesTool } from "./tools/connection/ListDatabasesTool.js";
import { UseConnectionTool } from "./tools/connection/UseConnectionTool.js";
import { UseDatabaseTool } from "./tools/connection/UseDatabaseTool.js";
import { AggregateTool } from "./tools/document/AggregateTool.js";
import { CountDocumentsTool } from "./tools/document/CountDocumentsTool.js";
import { DistinctValuesTool } from "./tools/document/DistinctValuesTool.js";
import { FindDocumentsTool } from "./tools/document/FindDocumentsTool.js";
import { RedisCommandTool } from "./tools/keyvalue/RedisCommandTool.js";
import { QUERY_TOOLS } from "./tools/QueryTools.js";
import { SearchTool } from "./tools/search/SearchTool.js";
import { RunQueryTool } from "./tools/sql/RunQueryTool.js";
import { MongoOperatorGuard } from "./validation/document/MongoOperatorGuard.js";
import { RedisCommandValidator } from "./validation/keyvalue/RedisCommandValidator.js";
import { NamePolicyRegistry } from "./validation/names/NamePolicyRegistry.js";
import { SearchBodyValidator } from "./validation/search/SearchBodyValidator.js";
import { SqlValidatorRegistry } from "./validation/sql/SqlValidatorRegistry.js";
import type { ConfigurationLoader } from "./types/config.types.js";
import type { DriverTuning } from "./types/connection.types.js";

/**
 * The composition root: the one place that knows how every part fits together.
 *
 * Every other class takes its collaborators through its constructor and
 * constructs none of them, which is why they can be unit tested without the
 * environment, without a database, and without module-level singletons. All of
 * that wiring has to happen somewhere, and concentrating it here keeps it out
 * of the classes themselves.
 *
 * This is also the only file that names a concrete driver class.
 */
export class ApplicationFactory {
  /** Not per-target: a handful of connections is ample for one assistant. */
  private static readonly CONNECTION_LIMIT = 3;

  /**
   * More databases than anyone flips between in a conversation, while bounding
   * total open connections at MAX_DRIVERS * CONNECTION_LIMIT.
   */
  private static readonly MAX_DRIVERS = 8;

  constructor(
    private readonly configLoader: ConfigurationLoader = new EnvironmentConfigLoader(),
    private readonly logger: (message: string) => void = (message) =>
      console.error(`[mcp-db-ro] ${message}`),
    private readonly versionLoader: PackageVersionLoader = new PackageVersionLoader()
  ) {}

  public create(): McpDbServer {
    const config = this.configLoader.load();

    // Warnings are collected by the loader and emitted here, so configuration
    // parsing stays pure and testable while the operator still sees problems.
    for (const warning of config.warnings) {
      this.logger(warning);
    }

    const registry = new ConnectionRegistry(config.profiles);
    const selectionWarning = registry.selectInitial(config.defaultProfileName);
    if (selectionWarning) {
      this.logger(selectionWarning);
    }
    this.reportActiveConnection(registry);

    const tuning: DriverTuning = {
      connectionLimit: ApplicationFactory.CONNECTION_LIMIT,
      connectTimeoutMs: config.connectTimeoutMs,
      queryTimeoutMs: config.queryTimeoutMs,
    };

    const cache = new DriverCache(this.createDriverRegistry(tuning), ApplicationFactory.MAX_DRIVERS);
    const connections = new ConnectionManager(registry, cache);
    const drivers = new DriverProvider(registry, cache, QUERY_TOOLS);

    const tools = this.createTools(connections, drivers);

    return new McpDbServer(tools, cache, this.logger, this.versionLoader.load());
  }

  /** One factory per engine. None of them does I/O; drivers connect on first use. */
  private createDriverRegistry(tuning: DriverTuning): DriverRegistry {
    return new DriverRegistry()
      .register("mysql", (target) => new MySqlDriver(target, tuning, this.logger))
      .register("postgres", (target) => new PostgresDriver(target, tuning))
      .register("sqlite", (target) => new SqliteDriver(target, tuning))
      .register("mssql", (target) => new MsSqlDriver(target, tuning))
      .register("clickhouse", (target) => new ClickHouseDriver(target, tuning))
      .register("mongodb", (target) => new MongoDriver(target, tuning))
      .register("redis", (target) => new RedisDriver(target, tuning, this.logger))
      .register("elasticsearch", (target) => new ElasticsearchDriver(target, tuning));
  }

  private createTools(connections: ConnectionManager, drivers: DriverProvider): BaseTool<never>[] {
    const names = new NamePolicyRegistry();
    const targetFactory = new ConnectionTargetFactory();
    const rows = new RowFormatter();
    const mongoGuard = new MongoOperatorGuard();

    const tools = [
      new CurrentConnectionTool(connections),
      new ListConnectionsTool(connections),
      new ListDatabasesTool(drivers),
      new UseDatabaseTool(connections, names),
      new UseConnectionTool(connections, names),
      new ConnectTool(connections, targetFactory, names),
      new ListTablesTool(drivers, names),
      new DescribeTableTool(drivers, names),
      new GetTableIndexesTool(drivers, names),
      new GetForeignKeysTool(drivers, names),
      new GetTableSampleTool(drivers, names),
      new RunQueryTool(drivers, names, new SqlValidatorRegistry(), rows),
      new FindDocumentsTool(drivers, names, mongoGuard, rows),
      new AggregateTool(drivers, names, mongoGuard, rows),
      new CountDocumentsTool(drivers, names, mongoGuard),
      new DistinctValuesTool(drivers, names, mongoGuard, rows),
      new SearchTool(drivers, names, new SearchBodyValidator()),
      new RedisCommandTool(drivers, names, new RedisCommandValidator()),
    ];

    // Each tool is typed by its own argument shape; the server only needs to
    // register them, so they are collected behind the common base type.
    return tools as unknown as BaseTool<never>[];
  }

  private reportActiveConnection(registry: ConnectionRegistry): void {
    const active = registry.getActiveTarget();
    if (active) {
      this.logger(
        `active connection: ${registry.getActiveName()} (${EngineCatalog.label(active.engine)}, ${active.describe()})`
      );
      return;
    }
    this.logger("no connection configured, call the connect tool to set one");
  }
}
