import type { ConnectionTarget } from "../domain/ConnectionTarget.js";
import type { DatabaseDriver } from "./DatabaseDriver.js";
import { DriverRegistry } from "./DriverRegistry.js";

/** The one thing ConnectionManager needs: proving a target works before switching to it. */
export interface ConnectionVerifier {
  verify(target: ConnectionTarget): Promise<void>;
}

/**
 * An Object Pool registry: one driver per distinct connection, with LRU
 * eviction.
 *
 * This is what makes switching cheap. Changing database selects a different
 * driver rather than reconnecting, and switching back reuses a warm one.
 *
 * Drivers are keyed by ConnectionTarget.key() rather than by, say, issuing
 * `USE` on a shared pool. A pool holds several connections and `USE` affects
 * only the one it ran on, so a later query served by a different connection
 * would silently run against the old database. Keying by target means every
 * connection a driver opens was pointed at the right database from the start.
 */
export class DriverCache implements ConnectionVerifier {
  private readonly drivers = new Map<string, DatabaseDriver>();

  constructor(
    private readonly registry: DriverRegistry,
    private readonly maxDrivers: number
  ) {}

  /**
   * The cached driver for this target, or a new one.
   *
   * A cached driver whose target has the same key but different credentials
   * is replaced, not reused. The key excludes the password by design, so
   * without this check a reconnect with a corrected password would keep
   * failing on the old one.
   */
  public async acquire(target: ConnectionTarget): Promise<DatabaseDriver> {
    const key = target.key();
    const existing = this.drivers.get(key);

    if (existing && existing.target.equals(target)) {
      this.touch(key, existing);
      return existing;
    }
    if (existing) {
      this.drivers.delete(key);
      await existing.close();
    }

    const driver = this.registry.create(target);
    this.drivers.set(key, driver);
    await this.evictOverflow();
    return driver;
  }

  /**
   * Open the connection and prove it works.
   *
   * A driver that fails verification is evicted, so the next attempt, perhaps
   * after the server has come back, starts from nothing.
   */
  public async verify(target: ConnectionTarget): Promise<void> {
    const driver = await this.acquire(target);
    try {
      await driver.verify();
    } catch (error) {
      if (this.drivers.get(target.key()) === driver) {
        this.drivers.delete(target.key());
      }
      await driver.close();
      throw error;
    }
  }

  /**
   * Closing drivers is what allows the process to exit: open sockets keep the
   * Node event loop alive.
   *
   * The map is cleared before awaiting, so a call arriving mid-shutdown gets a
   * fresh driver rather than one being torn down. Closes run concurrently,
   * because shutdown must not stall on one unreachable server.
   */
  public async closeAll(): Promise<void> {
    const open = Array.from(this.drivers.values());
    this.drivers.clear();
    await Promise.all(open.map((driver) => driver.close()));
  }

  public get size(): number {
    return this.drivers.size;
  }

  /**
   * A Map iterates in insertion order, so deleting and re-inserting moves an
   * entry to the back and leaves the least recently used at the front. That is
   * a complete LRU for two Map operations and no extra bookkeeping.
   */
  private touch(key: string, driver: DatabaseDriver): void {
    this.drivers.delete(key);
    this.drivers.set(key, driver);
  }

  /**
   * Runs after insertion, so the cap is briefly exceeded then corrected.
   * Evicting first would risk dropping the driver that is about to be used.
   */
  private async evictOverflow(): Promise<void> {
    while (this.drivers.size > this.maxDrivers) {
      const oldest = this.drivers.keys().next();
      if (oldest.done) {
        return;
      }
      const driver = this.drivers.get(oldest.value);
      this.drivers.delete(oldest.value);
      if (driver) {
        await driver.close();
      }
    }
  }
}
