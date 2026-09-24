import type { ProfileOrigin } from "../types/connection.types.js";
import { ConnectionTarget } from "./ConnectionTarget.js";
import { EngineCatalog } from "./Engine.js";

/**
 * A named connection.
 *
 * Distinct from ConnectionTarget because a name and an origin are not part of
 * a connection's identity: the same endpoint can be reachable as "staging" from
 * configuration and as an ad-hoc alias in the same session.
 */
export class ConnectionProfile {
  constructor(
    public readonly name: string,
    public readonly target: ConnectionTarget,
    public readonly origin: ProfileOrigin
  ) {
    Object.freeze(this);
  }

  /** Created from the environment, so it returns after a restart. */
  public static fromEnvironment(name: string, target: ConnectionTarget): ConnectionProfile {
    return new ConnectionProfile(name, target, "env");
  }

  /** Opened at runtime by the connect tool, so it is lost on exit. */
  public static fromSession(name: string, target: ConnectionTarget): ConnectionProfile {
    return new ConnectionProfile(name, target, "session");
  }

  /**
   * One line for `list_connections`. Never contains the password.
   *
   * Names the engine in words as well as through the scheme, because with
   * eight engines behind one server "which kind of database is this" is the
   * first thing a reader needs to know about each line.
   */
  public describe(isActive: boolean): string {
    const marker = isActive ? "* " : "  ";
    const label = EngineCatalog.label(this.target.engine);
    return `${marker}${this.name} (${this.origin}, ${label}) -> ${this.target.describe()}`;
  }
}
