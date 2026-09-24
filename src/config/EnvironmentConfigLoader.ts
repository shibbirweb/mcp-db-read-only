import { ConnectionProfile } from "../domain/ConnectionProfile.js";
import { ConnectionTargetFactory } from "../connections/ConnectionTargetFactory.js";
import type { ConfigurationLoader, LoadedConfiguration } from "../types/config.types.js";
import type {
  RawMySqlProfileDefinition,
  RawUrlProfileDefinition,
} from "../types/connection.types.js";

/**
 * Reads configuration from environment variables.
 *
 * Implements ConfigurationLoader so tests, and any future file or remote
 * source, can be substituted without touching anything downstream.
 *
 * Two families of variables are read, in this order of precedence:
 *
 * 1. `DB_PROFILES` and `DB_URL`, the native form: connection URLs for any
 *    engine.
 * 2. `MYSQL_PROFILES` and `MYSQL_HOST`/`USER`/`DATABASE`, the configuration
 *    of the MySQL-only server this one generalises. Read so that an existing
 *    setup keeps working unchanged when the image is swapped. A profile name
 *    already defined by the native form wins.
 *
 * Two properties are deliberate:
 *
 * - **Nothing is logged here.** Problems are returned as `warnings` and the
 *   composition root decides where they go. That keeps the loader pure, and
 *   lets tests assert on warnings instead of intercepting console output.
 * - **Nothing is fatal.** Malformed JSON, a broken profile, or no
 *   configuration at all all produce a usable result. A server that starts and
 *   explains the problem can be fixed with the connect tool; one that exits
 *   during handshake is reported by the client as a broken install.
 */
export class EnvironmentConfigLoader implements ConfigurationLoader {
  public static readonly DEFAULT_QUERY_TIMEOUT_MS = 30000;
  public static readonly DEFAULT_CONNECT_TIMEOUT_MS = 10000;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly targetFactory: ConnectionTargetFactory = new ConnectionTargetFactory()
  ) {}

  public load(): LoadedConfiguration {
    const warnings: string[] = [];
    const profiles = new Map<string, ConnectionProfile>();

    this.loadUrlProfiles(profiles, warnings);
    this.loadSingleUrl(profiles, warnings);
    this.loadLegacyMySqlProfiles(profiles, warnings);
    this.loadLegacyMySqlConnection(profiles);

    return {
      profiles: Array.from(profiles.values()),
      defaultProfileName: this.env.DB_DEFAULT_PROFILE || this.env.MYSQL_DEFAULT_PROFILE || null,
      queryTimeoutMs: this.readTimeout(
        this.env.DB_QUERY_TIMEOUT_MS ?? this.env.MYSQL_QUERY_TIMEOUT_MS,
        EnvironmentConfigLoader.DEFAULT_QUERY_TIMEOUT_MS
      ),
      connectTimeoutMs: this.readTimeout(
        this.env.DB_CONNECT_TIMEOUT_MS ?? this.env.MYSQL_CONNECT_TIMEOUT_MS,
        EnvironmentConfigLoader.DEFAULT_CONNECT_TIMEOUT_MS
      ),
      warnings,
    };
  }

  /**
   * DB_PROFILES: `{"name": "url"}` or `{"name": {"url": "...", "password": "..."}}`.
   *
   * The object form exists for passwords. A password inside a URL must be
   * percent-encoded, and one containing `@`, `/` or `#` silently splits the URL
   * in the wrong place when it is not. Giving it its own field removes that
   * whole class of mistake.
   */
  private loadUrlProfiles(target: Map<string, ConnectionProfile>, warnings: string[]): void {
    const parsed = this.readJsonObject("DB_PROFILES", warnings);
    if (!parsed) {
      return;
    }

    for (const [name, definition] of Object.entries(parsed)) {
      const entry = this.readUrlDefinition(definition);
      if (!entry) {
        warnings.push(`Skipping profile "${name}": expected a URL string or an object with "url".`);
        continue;
      }
      try {
        const connection = this.targetFactory.fromUrl(entry.url, entry.password);
        target.set(name, ConnectionProfile.fromEnvironment(name, connection));
      } catch (error) {
        warnings.push(`Skipping profile "${name}": ${this.reason(error)}`);
      }
    }
  }

  /** DB_URL, with DB_PASSWORD as its optional separate password, as `default`. */
  private loadSingleUrl(target: Map<string, ConnectionProfile>, warnings: string[]): void {
    const url = this.env.DB_URL;
    if (!url || target.has("default")) {
      return;
    }
    try {
      const connection = this.targetFactory.fromUrl(url, this.env.DB_PASSWORD);
      target.set("default", ConnectionProfile.fromEnvironment("default", connection));
    } catch (error) {
      warnings.push(`Ignoring DB_URL: ${this.reason(error)}`);
    }
  }

  /** The legacy MYSQL_PROFILES object form, exactly as the MySQL-only server read it. */
  private loadLegacyMySqlProfiles(target: Map<string, ConnectionProfile>, warnings: string[]): void {
    const parsed = this.readJsonObject("MYSQL_PROFILES", warnings);
    if (!parsed) {
      return;
    }

    for (const [name, definition] of Object.entries(parsed)) {
      if (target.has(name)) {
        warnings.push(`Skipping MYSQL_PROFILES "${name}": DB_PROFILES already defines it.`);
        continue;
      }
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        warnings.push(`Skipping profile "${name}": not an object.`);
        continue;
      }
      try {
        const connection = this.targetFactory.fromMySqlDefinition(
          definition as RawMySqlProfileDefinition,
          name
        );
        target.set(name, ConnectionProfile.fromEnvironment(name, connection));
      } catch (error) {
        warnings.push(`Skipping profile "${name}": ${this.reason(error)}`);
      }
    }
  }

  /**
   * The MYSQL_HOST/USER/DATABASE form, registered as a profile named `default`
   * unless something above already claimed that name.
   */
  private loadLegacyMySqlConnection(target: Map<string, ConnectionProfile>): void {
    const user = this.env.MYSQL_USER;
    const database = this.env.MYSQL_DATABASE;

    if (!user || !database || target.has("default")) {
      return;
    }

    const connection = this.targetFactory.fromMySqlValues({
      host: this.env.MYSQL_HOST,
      port: this.env.MYSQL_PORT ? Number.parseInt(this.env.MYSQL_PORT, 10) : undefined,
      user,
      password: this.env.MYSQL_PASSWORD ?? "",
      database,
    });

    target.set("default", ConnectionProfile.fromEnvironment("default", connection));
  }

  private readJsonObject(variable: string, warnings: string[]): Record<string, unknown> | null {
    const raw = this.env[variable];
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      warnings.push(`${variable} is not valid JSON, ignoring it: ${this.reason(error)}`);
      return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push(`${variable} must be a JSON object of named profiles, ignoring it.`);
      return null;
    }

    return parsed as Record<string, unknown>;
  }

  private readUrlDefinition(definition: unknown): { url: string; password?: string } | null {
    if (typeof definition === "string" && definition) {
      return { url: definition };
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      return null;
    }
    const raw = definition as RawUrlProfileDefinition;
    if (typeof raw.url !== "string" || !raw.url) {
      return null;
    }
    return {
      url: raw.url,
      password: typeof raw.password === "string" ? raw.password : undefined,
    };
  }

  private readTimeout(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
