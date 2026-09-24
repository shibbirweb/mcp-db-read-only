import { resolve } from "node:path";
import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { InvalidProfileDefinitionError } from "../errors/InvalidProfileDefinitionError.js";
import type { RawMySqlProfileDefinition } from "../types/connection.types.js";
import { ConnectionUrlParser } from "./ConnectionUrlParser.js";

/**
 * Builds ConnectionTarget instances from untrusted input.
 *
 * A Factory rather than a constructor because the input arrives in three
 * shapes (a URL, a legacy MYSQL_PROFILES object, and the legacy MYSQL_*
 * variables) and every one has to be checked and defaulted the same way.
 * Keeping all three here means they cannot drift apart in what they accept.
 */
export class ConnectionTargetFactory {
  /**
   * The legacy MYSQL_* form's default host.
   *
   * `localhost` inside a container means the container itself, which is the
   * single most common mistake when the database runs on the host. Kept from
   * the MySQL-only server so an existing configuration behaves identically.
   * URLs always name their host, so this never applies to them.
   */
  public static readonly DEFAULT_MYSQL_HOST = "host.docker.internal";
  public static readonly DEFAULT_MYSQL_PORT = 3306;

  /**
   * @param resolvePath turns a SQLite path absolute. Injected so tests do not
   *   depend on the directory they run from.
   */
  constructor(
    private readonly parser: ConnectionUrlParser = new ConnectionUrlParser(),
    private readonly resolvePath: (path: string) => string = (path) => resolve(path)
  ) {}

  /**
   * @param password used instead of the URL's own password when non-empty, so
   *   a password full of `@`, `/` and `#` never needs percent-encoding.
   * @throws InvalidConnectionUrlError describing the problem without the URL.
   */
  public fromUrl(url: string, password?: string): ConnectionTarget {
    const props = this.parser.parse(url);

    // A SQLite path is made absolute once, here, so the same file reached as
    // `./app.db` and `/work/app.db` is recognised as one connection, and so a
    // later change of working directory cannot repoint it.
    const database = props.engine === "sqlite" ? this.resolvePath(props.database) : props.database;

    return new ConnectionTarget({
      ...props,
      password: password ? password : props.password,
      database,
    });
  }

  /**
   * One entry of the legacy MYSQL_PROFILES object form.
   *
   * @throws InvalidProfileDefinitionError when user or database is missing.
   *   The caller turns this into a warning; one broken profile must not stop
   *   the server from starting.
   */
  public fromMySqlDefinition(raw: RawMySqlProfileDefinition, profileName: string): ConnectionTarget {
    const user = this.readString(raw.user);
    const database = this.readString(raw.database);

    if (!user) {
      throw new InvalidProfileDefinitionError(profileName, 'is missing "user".');
    }
    if (!database) {
      throw new InvalidProfileDefinitionError(profileName, 'is missing "database".');
    }

    return this.fromMySqlValues({
      host: this.readString(raw.host),
      port: this.readPort(raw.port),
      user,
      password: this.readString(raw.password),
      database,
    });
  }

  /** Builds a MySQL target from already-trusted values, applying the legacy defaults. */
  public fromMySqlValues(values: {
    host?: string;
    port?: number;
    user: string;
    password?: string;
    database: string;
  }): ConnectionTarget {
    return new ConnectionTarget({
      engine: "mysql",
      scheme: "mysql",
      hosts: [
        {
          host: values.host || ConnectionTargetFactory.DEFAULT_MYSQL_HOST,
          port: values.port ?? ConnectionTargetFactory.DEFAULT_MYSQL_PORT,
        },
      ],
      user: values.user,
      password: values.password ?? "",
      database: values.database,
      options: {},
      secretOptions: {},
    });
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * Only a real number is accepted. A port given as the string "3306" falls
   * back to the default rather than becoming NaN and failing much later with
   * an unrecognisable error.
   */
  private readPort(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
  }
}
