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
import { CallLogger } from "./logging/CallLogger.js";
import { TextLogChannel, type LogChannel } from "./logging/LogChannel.js";
import { LiveLogViewer } from "./logging/viewer/LiveLogViewer.js";
import { LiveViewerObserver } from "./logging/viewer/LiveViewerObserver.js";
import { FolderLogChannel } from "./logging/store/FolderLogChannel.js";
import { FolderLogStore } from "./logging/store/FolderLogStore.js";
import type { LogStore } from "./logging/store/LogStore.js";
import { MemoryLogStore } from "./logging/store/MemoryLogStore.js";
import type { BackgroundService } from "./server/BackgroundService.js";
import { JsonLogFormatter, PrettyLogFormatter } from "./logging/LogFormatter.js";
import { FileSink, StderrSink } from "./logging/LogSink.js";
import { SilentTracer, type StatementTracer } from "./logging/StatementTracer.js";
import { SilentObserver, type ToolCallObserver } from "./logging/ToolCallObserver.js";
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
import type { ConfigurationLoader, LoggingSettings } from "./types/config.types.js";
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

  /**
   * Set once built, for the call log's client name: the logger has to exist
   * before the server that will learn the name at handshake.
   */
  private server: McpDbServer | null = null;

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

    const callLog = this.createCallLog(config.logging, registry);

    const cache = new DriverCache(
      this.createDriverRegistry(tuning, callLog.tracer),
      ApplicationFactory.MAX_DRIVERS
    );
    const connections = new ConnectionManager(registry, cache);
    const drivers = new DriverProvider(registry, cache, QUERY_TOOLS);

    const tools = this.createTools(connections, drivers, callLog.viewerStatus);

    const server = new McpDbServer(tools, cache, this.logger, callLog.observer, callLog.services, this.versionLoader.load());
    this.server = server;
    return server;
  }

  /**
   * The call log when DB_LOG or DB_LOG_FILE asks for it, silent stand-ins
   * otherwise. One CallLogger plays both roles, observer for the tools and
   * tracer for the drivers, which is what lets it nest each driver statement
   * under the call that caused it.
   */
  private createCallLog(
    settings: LoggingSettings,
    registry: ConnectionRegistry
  ): {
    observer: ToolCallObserver;
    tracer: StatementTracer;
    services: BackgroundService[];
    viewerStatus: () => string | null;
  } {
    if (!settings.enabled) {
      return { observer: new SilentObserver(), tracer: new SilentTracer(), services: [], viewerStatus: () => null };
    }

    const channels: LogChannel[] = [];
    const services: BackgroundService[] = [];
    let viewer: LiveLogViewer | null = null;
    const outputs: string[] = [];

    const sink = settings.file ? new FileSink(settings.file) : new StderrSink();
    if (settings.text) {
      const formatter = settings.format === "json" ? new JsonLogFormatter() : new PrettyLogFormatter();
      channels.push(new TextLogChannel(sink, formatter));
      outputs.push(`${settings.format} text to ${sink.description}`);
    }

    // The viewer reads the folder when there is one, which also shows the
    // calls of every other copy of the server saving there, and otherwise
    // keeps this process's recent entries in memory.
    let store: LogStore;
    if (settings.directory) {
      const folderStore = new FolderLogStore(settings.directory);
      store = folderStore;
      channels.push(new FolderLogChannel(settings.directory, (entry) => folderStore.noteWritten(entry)));
      outputs.push(`one JSON file per entry in ${settings.directory}`);
    } else {
      const memoryStore = new MemoryLogStore(settings.viewerHistory);
      store = memoryStore;
      if (settings.viewerPort !== null) {
        channels.push(memoryStore);
      }
    }

    if (settings.viewerPort !== null) {
      // Always all interfaces, as configured: reachable from other machines
      // and from a Docker host without extra settings. The viewer announces
      // that it has no access control when it starts, which is on the first
      // tool call rather than here.
      viewer = new LiveLogViewer("0.0.0.0", settings.viewerPort, store, this.logger);
      services.push(viewer);
    }

    const logger = new CallLogger(
      channels,
      () => {
        const target = registry.getActiveTarget();
        return target
          ? `${registry.getActiveName()} (${EngineCatalog.label(target.engine)}) ${target.describe()}`
          : null;
      },
      this.logger,
      () => this.clientName()
    );

    // Said once at startup, because with logging on every query and every
    // result is being written somewhere, and the operator should know where.
    this.logger(`call logging on: every tool call, its statements and its full output are written as ${outputs.join(" and ")}`);

    const fallback = outputs.length > 0 ? outputs.join(" and ") : "nowhere else";
    const observer = viewer ? new LiveViewerObserver(logger, viewer, fallback, this.logger) : logger;
    return {
      observer,
      tracer: logger,
      services,
      viewerStatus: () => (viewer ? this.describeViewer(viewer) : null),
    };
  }

  private clientName(): string | null {
    return this.server?.clientName() ?? null;
  }

  /** One line for current_connection. */
  private describeViewer(viewer: LiveLogViewer): string {
    const status = viewer.status;
    switch (status.state) {
      case "running":
        return `running at ${status.url}`;
      case "unavailable":
        return `unavailable, ${status.reason} (free it or set DB_LOG_PORT to another port)`;
      case "idle":
        return "starts on the first tool call";
    }
  }

  /** One factory per engine. None of them does I/O; drivers connect on first use. */
  private createDriverRegistry(tuning: DriverTuning, tracer: StatementTracer): DriverRegistry {
    return new DriverRegistry()
      .register("mysql", (target) => new MySqlDriver(target, tuning, tracer, this.logger))
      .register("postgres", (target) => new PostgresDriver(target, tuning, tracer))
      .register("sqlite", (target) => new SqliteDriver(target, tuning, tracer))
      .register("mssql", (target) => new MsSqlDriver(target, tuning, tracer))
      .register("clickhouse", (target) => new ClickHouseDriver(target, tuning, tracer))
      .register("mongodb", (target) => new MongoDriver(target, tuning, tracer))
      .register("redis", (target) => new RedisDriver(target, tuning, tracer, this.logger))
      .register("elasticsearch", (target) => new ElasticsearchDriver(target, tuning, tracer));
  }

  private createTools(
    connections: ConnectionManager,
    drivers: DriverProvider,
    viewerStatus: () => string | null
  ): BaseTool<never>[] {
    const names = new NamePolicyRegistry();
    const targetFactory = new ConnectionTargetFactory();
    const rows = new RowFormatter();
    const mongoGuard = new MongoOperatorGuard();

    const tools = [
      new CurrentConnectionTool(connections, viewerStatus),
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
