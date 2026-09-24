import type { Engine } from "./Engine.js";
import type { ConnectionTargetProps, HostAddress } from "../types/connection.types.js";

/**
 * An immutable value object describing one connection, on any engine.
 *
 * Immutability is the point. A plain object passed around has to be
 * spread-copied on every assignment, and a single missed copy means mutating
 * the active connection silently rewrites the stored profile it came from.
 * Here there is no setter to forget: `withDatabase` returns a new instance and
 * the original cannot change.
 *
 * Identity is defined by the value of every non-secret field, exposed through
 * `key()`, so the driver cache can treat two equal targets as one connection.
 */
export class ConnectionTarget {
  public readonly engine: Engine;
  public readonly scheme: string;
  public readonly hosts: readonly HostAddress[];
  public readonly user: string;
  public readonly password: string;
  public readonly database: string;
  public readonly options: Readonly<Record<string, string>>;
  public readonly secretOptions: Readonly<Record<string, string>>;

  constructor(props: ConnectionTargetProps) {
    this.engine = props.engine;
    this.scheme = props.scheme;
    this.hosts = Object.freeze(props.hosts.map((entry) => Object.freeze({ ...entry })));
    this.user = props.user;
    this.password = props.password;
    this.database = props.database;
    this.options = Object.freeze({ ...props.options });
    this.secretOptions = Object.freeze({ ...props.secretOptions });
    Object.freeze(this);
  }

  /** The first host, which is the only one for every engine but MongoDB. */
  public get host(): string {
    return this.hosts[0]?.host ?? "";
  }

  public get port(): number {
    return this.hosts[0]?.port ?? 0;
  }

  /**
   * Stable identity, and the driver cache key.
   *
   * The password and every secret option are excluded deliberately: they are
   * not part of what makes two connections the same endpoint, and this string
   * is shown to users and written to logs. Because identity and display are
   * the same string by construction, they cannot drift apart.
   *
   * A field added to this class that distinguishes two otherwise identical
   * connections must be added here too, or the second will silently reuse the
   * first one's driver.
   */
  public key(): string {
    if (this.engine === "sqlite") {
      return `sqlite:${this.database}`;
    }

    const user = this.user ? `${this.user}@` : "";
    const hosts = this.hosts
      .map((entry) => (entry.port > 0 ? `${entry.host}:${entry.port}` : entry.host))
      .join(",");
    return `${this.scheme}://${user}${hosts}/${this.database}${this.optionSuffix()}`;
  }

  /** Human-readable form. Same as the key, and safe to print. */
  public describe(): string {
    return this.key();
  }

  /**
   * Same endpoint and same credentials.
   *
   * `key()` alone is not enough for the driver cache: a reconnect with a
   * corrected password has the same key, and reusing the cached driver would
   * keep using the wrong password.
   */
  public equals(other: ConnectionTarget): boolean {
    return (
      this.key() === other.key() &&
      this.password === other.password &&
      ConnectionTarget.sameRecord(this.secretOptions, other.secretOptions)
    );
  }

  /** A copy pointing at a different database. The receiver is untouched. */
  public withDatabase(database: string): ConnectionTarget {
    return new ConnectionTarget({ ...this.toProps(), database });
  }

  /**
   * A URL parameter by name, ignoring case.
   *
   * Case-insensitive because connection-string conventions disagree
   * (`trustServerCertificate`, `sslmode`, `authSource`), and a lookup that
   * silently misses `TrustServerCertificate` would quietly change behaviour.
   */
  public option(name: string): string | undefined {
    return ConnectionTarget.lookup(this.options, name);
  }

  public secretOption(name: string): string | undefined {
    return ConnectionTarget.lookup(this.secretOptions, name);
  }

  /** Reads a boolean URL parameter: true, 1 and yes are true. */
  public flag(name: string): boolean | undefined {
    const value = this.option(name);
    if (value === undefined) {
      return undefined;
    }
    return ["true", "1", "yes"].includes(value.toLowerCase());
  }

  public toProps(): ConnectionTargetProps {
    return {
      engine: this.engine,
      scheme: this.scheme,
      hosts: this.hosts,
      user: this.user,
      password: this.password,
      database: this.database,
      options: this.options,
      secretOptions: this.secretOptions,
    };
  }

  /** Sorted so the same options in a different order are the same target. */
  private optionSuffix(): string {
    const entries = Object.entries(this.options).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) {
      return "";
    }
    return `?${entries.map(([name, value]) => `${name}=${value}`).join("&")}`;
  }

  private static lookup(record: Readonly<Record<string, string>>, name: string): string | undefined {
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(record)) {
      if (key.toLowerCase() === wanted) {
        return value;
      }
    }
    return undefined;
  }

  private static sameRecord(
    left: Readonly<Record<string, string>>,
    right: Readonly<Record<string, string>>
  ): boolean {
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) {
      return false;
    }
    return leftKeys.every((key) => left[key] === right[key]);
  }
}
