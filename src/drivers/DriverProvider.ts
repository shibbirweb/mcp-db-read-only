import { ConnectionManager } from "../connections/ConnectionManager.js";
import { ConnectionRegistry } from "../connections/ConnectionRegistry.js";
import type { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { EngineCatalog } from "../domain/Engine.js";
import type { EngineFamily } from "../domain/Engine.js";
import { EngineMismatchError } from "../errors/EngineMismatchError.js";
import type {
  DatabaseDriver,
  DocumentDriver,
  KeyValueDriver,
  SearchDriver,
  SqlDriver,
} from "./DatabaseDriver.js";
import { DriverCache } from "./DriverCache.js";

/** The query tools for each family, named in the error when a tool meets the wrong engine. */
export type QueryToolIndex = Readonly<Record<EngineFamily, readonly string[]>>;

/**
 * Resolves which connection a tool call belongs to, and hands back its driver.
 *
 * A Facade over the registry and the driver cache, so tools never learn how a
 * target becomes a driver. It is also the single place a call decides which
 * connection it belongs to, which is why the per-call `database` override
 * costs one argument in each tool rather than a branch.
 */
export class DriverProvider {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly cache: DriverCache,
    private readonly queryTools: QueryToolIndex
  ) {}

  /** @throws NoActiveConnectionError when nothing is configured yet. */
  public requireActiveTarget(): ConnectionTarget {
    return this.registry.requireActiveTarget();
  }

  /**
   * No argument means the active connection; a database name means the active
   * connection pointed at that database for this call only.
   *
   * @throws UnsupportedOperationError on an engine with nothing to switch to.
   */
  public resolveTarget(database?: string): ConnectionTarget {
    const active = this.registry.requireActiveTarget();
    if (!database) {
      return active;
    }
    ConnectionManager.assertSwitchable(active);
    return active.withDatabase(database);
  }

  public acquire(target: ConnectionTarget): Promise<DatabaseDriver> {
    return this.cache.acquire(target);
  }

  /**
   * Checked against the engine catalog before the driver is acquired, so the
   * mismatch is reported without constructing anything.
   *
   * @throws EngineMismatchError naming the tools that do fit the active engine.
   */
  public requireFamily(target: ConnectionTarget, family: EngineFamily, toolName: string): void {
    const engine = EngineCatalog.describe(target.engine);
    if (engine.family === family) {
      return;
    }
    throw new EngineMismatchError(
      toolName,
      EngineCatalog.labelsFor(family),
      engine.label,
      this.queryTools[engine.family]
    );
  }

  public async acquireSql(target: ConnectionTarget, toolName: string): Promise<SqlDriver> {
    this.requireFamily(target, "sql", toolName);
    return (await this.acquire(target)) as SqlDriver;
  }

  public async acquireDocument(target: ConnectionTarget, toolName: string): Promise<DocumentDriver> {
    this.requireFamily(target, "document", toolName);
    return (await this.acquire(target)) as DocumentDriver;
  }

  public async acquireKeyValue(target: ConnectionTarget, toolName: string): Promise<KeyValueDriver> {
    this.requireFamily(target, "keyvalue", toolName);
    return (await this.acquire(target)) as KeyValueDriver;
  }

  public async acquireSearch(target: ConnectionTarget, toolName: string): Promise<SearchDriver> {
    this.requireFamily(target, "search", toolName);
    return (await this.acquire(target)) as SearchDriver;
  }
}
