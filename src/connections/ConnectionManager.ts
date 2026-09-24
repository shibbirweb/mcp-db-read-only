import { ConnectionProfile } from "../domain/ConnectionProfile.js";
import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { EngineCatalog } from "../domain/Engine.js";
import { UnknownProfileError } from "../errors/UnknownProfileError.js";
import { UnsupportedOperationError } from "../errors/UnsupportedOperationError.js";
import type { ConnectionVerifier } from "../drivers/DriverCache.js";
import { ConnectionRegistry } from "./ConnectionRegistry.js";

/**
 * Orchestrates changing the active connection.
 *
 * Sits between the tools and the registry so that every switch follows the
 * same rule: **verify, then commit**. The registry cannot enforce that itself
 * without taking a dependency on the drivers, and the tools should not each be
 * trusted to remember it.
 *
 * Committing only after a successful verification is what makes a failed
 * switch harmless: the previous connection stays active and the session
 * remains usable.
 */
export class ConnectionManager {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly drivers: ConnectionVerifier
  ) {}

  public getActiveTarget(): ConnectionTarget | null {
    return this.registry.getActiveTarget();
  }

  public getActiveName(): string | null {
    return this.registry.getActiveName();
  }

  public requireActiveTarget(): ConnectionTarget {
    return this.registry.requireActiveTarget();
  }

  public listProfiles(): ConnectionProfile[] {
    return this.registry.list();
  }

  public findProfile(profileName: string): ConnectionProfile | undefined {
    return this.registry.find(profileName);
  }

  /**
   * Move to a different database on the current server.
   *
   * Keeps the current profile label: the connection is still "staging", just
   * pointed elsewhere, and renaming it would throw away that context.
   *
   * @throws UnsupportedOperationError for engines with nothing to switch to,
   *   before any network work.
   */
  public async useDatabase(database: string): Promise<ConnectionTarget> {
    const active = this.registry.requireActiveTarget();
    ConnectionManager.assertSwitchable(active);

    const candidate = active.withDatabase(database);
    await this.drivers.verify(candidate);
    return this.registry.activateTarget(candidate, this.registry.getActiveName() ?? "custom");
  }

  /**
   * Move to a named profile, optionally overriding its database.
   *
   * @throws UnknownProfileError carrying the known names, checked before any
   *   network work so a typo fails instantly.
   */
  public async useProfile(profileName: string, database?: string): Promise<ConnectionTarget> {
    const profile = this.registry.find(profileName);
    if (!profile) {
      throw new UnknownProfileError(profileName, this.registry.names());
    }

    let candidate = profile.target;
    if (database) {
      ConnectionManager.assertSwitchable(profile.target);
      candidate = profile.target.withDatabase(database);
    }

    await this.drivers.verify(candidate);
    return this.registry.activateTarget(candidate, profileName);
  }

  /**
   * Open an arbitrary connection and keep it under an alias for the session.
   *
   * This is what makes a restart unnecessary in every case: DB_PROFILES is a
   * convenience, this is the guarantee. Credentials are held in memory only
   * and vanish on exit, which list_connections communicates via the `session`
   * origin.
   */
  public async connect(target: ConnectionTarget, alias: string): Promise<ConnectionTarget> {
    await this.drivers.verify(target);
    this.registry.register(ConnectionProfile.fromSession(alias, target));
    return this.registry.activateTarget(target, alias);
  }

  /**
   * Shared with DriverProvider so use_database and the per-call `database`
   * argument refuse in exactly the same words.
   */
  public static assertSwitchable(target: ConnectionTarget): void {
    const engine = EngineCatalog.describe(target.engine);
    if (engine.switchesDatabases) {
      return;
    }
    const alternative =
      target.engine === "sqlite"
        ? "The file is the database; call connect with another sqlite:// URL to open a different one."
        : "Its indices are listed by list_tables.";
    throw new UnsupportedOperationError(engine.label, "separate databases to switch between", alternative);
  }
}
