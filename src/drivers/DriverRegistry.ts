import type { ConnectionTarget } from "../domain/ConnectionTarget.js";
import type { Engine } from "../domain/Engine.js";
import type { DatabaseDriver } from "./DatabaseDriver.js";

/** Builds a driver for one target. Must do no I/O; drivers connect lazily. */
export type DriverFactory = (target: ConnectionTarget) => DatabaseDriver;

/**
 * Which driver serves which engine: an Abstract Factory keyed by engine.
 *
 * The composition root registers one factory per engine. Nothing else in the
 * server names a concrete driver class, which is what lets the connection and
 * tool layers stay engine-agnostic, and lets tests register a fake.
 */
export class DriverRegistry {
  private readonly factories = new Map<Engine, DriverFactory>();

  public register(engine: Engine, factory: DriverFactory): this {
    this.factories.set(engine, factory);
    return this;
  }

  public create(target: ConnectionTarget): DatabaseDriver {
    const factory = this.factories.get(target.engine);
    if (!factory) {
      throw new Error(`No driver is registered for ${target.engine}.`);
    }
    return factory(target);
  }

  public engines(): Engine[] {
    return Array.from(this.factories.keys());
  }
}
