import type { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { EngineCatalog } from "../domain/Engine.js";
import type { EngineFamily } from "../domain/Engine.js";
import { NoDatabaseSelectedError } from "../errors/NoDatabaseSelectedError.js";
import { UnsupportedOperationError } from "../errors/UnsupportedOperationError.js";
import type { DatabaseEntry, ObjectListing } from "../types/driver.types.js";
import type { DatabaseDriver } from "./DatabaseDriver.js";

/**
 * Shared behaviour for every driver.
 *
 * The two optional capabilities, indexes and foreign keys, default to a
 * refusal here, so an engine without them needs no code to say so, and an
 * engine that has them overrides the one method.
 */
export abstract class BaseDriver implements DatabaseDriver {
  public abstract readonly family: EngineFamily;

  constructor(public readonly target: ConnectionTarget) {}

  public abstract verify(): Promise<void>;
  public abstract close(): Promise<void>;
  public abstract listDatabases(): Promise<DatabaseEntry[]>;
  public abstract listObjects(pattern: string | undefined, limit: number): Promise<ObjectListing>;
  public abstract describeObject(name: string): Promise<unknown>;
  public abstract sample(name: string, limit: number): Promise<unknown>;

  public async listIndexes(_name: string): Promise<unknown> {
    throw new UnsupportedOperationError(this.label, "indexes to list");
  }

  public async listForeignKeys(_name: string): Promise<unknown[]> {
    throw new UnsupportedOperationError(this.label, "foreign keys");
  }

  protected get label(): string {
    return EngineCatalog.label(this.target.engine);
  }

  protected get objectNoun(): string {
    return EngineCatalog.describe(this.target.engine).objectNoun;
  }

  /** @throws NoDatabaseSelectedError explaining how to choose one. */
  protected requireDatabase(): string {
    if (!this.target.database) {
      throw new NoDatabaseSelectedError(this.label);
    }
    return this.target.database;
  }
}
