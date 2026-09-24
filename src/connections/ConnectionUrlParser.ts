import { EngineCatalog } from "../domain/Engine.js";
import type { EngineDescriptor, SchemeDescriptor } from "../domain/Engine.js";
import { InvalidConnectionUrlError } from "../errors/InvalidConnectionUrlError.js";
import type { ConnectionTargetProps, HostAddress } from "../types/connection.types.js";

/**
 * Parses a connection URL for any supported engine into target fields.
 *
 * Hand-written rather than delegated to the WHATWG `URL` class, which cannot
 * parse the one URL shape this server most needs to accept: a MongoDB replica
 * set, `mongodb://a:27017,b:27017/app`, whose comma-separated authority is not
 * a valid host to `URL` and throws. It also cannot express a SQLite path.
 * Since one engine needed a custom parser, every engine uses the same one, so
 * the rules for credentials, ports and options are identical everywhere.
 *
 * Nothing thrown from here contains the URL. See InvalidConnectionUrlError.
 */
export class ConnectionUrlParser {
  private static readonly SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):([\s\S]*)$/;

  /**
   * Query parameters that are credentials, kept apart so they never reach a
   * displayed or logged string. Matched loosely on purpose: a false positive
   * only hides a harmless option from `list_connections`, while a false
   * negative prints a secret.
   */
  private static readonly SECRET_OPTION = /(pass|secret|token|api[_-]?key|credential)/i;

  public parse(url: string): ConnectionTargetProps {
    const match = ConnectionUrlParser.SCHEME.exec(url.trim());
    if (!match) {
      throw new InvalidConnectionUrlError(
        `expected <scheme>://..., with one of: ${EngineCatalog.schemeNames().join(", ")}.`
      );
    }

    const schemeName = match[1].toLowerCase();
    const found = EngineCatalog.findScheme(schemeName);
    if (!found) {
      throw new InvalidConnectionUrlError(
        `unsupported scheme "${schemeName}". Supported: ${EngineCatalog.schemeNames().join(", ")}.`
      );
    }

    if (found.engine.engine === "sqlite") {
      return this.parseSqlite(match[2]);
    }
    return this.parseNetworked(match[2], found.engine, found.scheme);
  }

  /**
   * `sqlite:///abs/path.db`, `sqlite://relative.db` and `sqlite:relative.db`
   * all name a file. Everything after the scheme up to `?` is the path, so a
   * path containing `@` or `:` is not misread as credentials or a port.
   */
  private parseSqlite(rest: string): ConnectionTargetProps {
    const withoutSlashes = rest.startsWith("//") ? rest.slice(2) : rest;
    const queryAt = withoutSlashes.indexOf("?");
    const rawPath = queryAt === -1 ? withoutSlashes : withoutSlashes.slice(0, queryAt);
    const query = queryAt === -1 ? "" : withoutSlashes.slice(queryAt + 1);
    const path = this.decode(rawPath, "the file path");

    if (!path) {
      throw new InvalidConnectionUrlError("a sqlite URL needs a file path, e.g. sqlite:///data/app.db.");
    }
    // An in-memory database opened read-only is empty and always will be, so
    // accepting it would only produce a connection that can never show
    // anything.
    if (path === ":memory:") {
      throw new InvalidConnectionUrlError("an in-memory SQLite database is always empty when read-only.");
    }

    const { options, secretOptions } = this.parseQuery(query);
    return {
      engine: "sqlite",
      scheme: "sqlite",
      hosts: [],
      user: "",
      password: "",
      database: path,
      options,
      secretOptions,
    };
  }

  /**
   * `scheme://[user[:password]@]host[:port][,host[:port]...][/database][?options]`
   *
   * The authority ends at the first `/`, `?` or `#`, as RFC 3986 says, so a
   * password containing any of those must be percent-encoded. That is why the
   * connect tool and DB_PROFILES also accept the password separately.
   */
  private parseNetworked(
    rest: string,
    engine: EngineDescriptor,
    scheme: SchemeDescriptor
  ): ConnectionTargetProps {
    if (!rest.startsWith("//")) {
      throw new InvalidConnectionUrlError(`expected "${scheme.name}://" followed by a host.`);
    }

    const remainder = rest.slice(2);
    const authorityEnd = this.firstIndexOf(remainder, ["/", "?", "#"]);
    const authority = authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
    const tail = (authorityEnd === -1 ? "" : remainder.slice(authorityEnd)).split("#")[0];

    const queryAt = tail.indexOf("?");
    const path = queryAt === -1 ? tail : tail.slice(0, queryAt);
    const query = queryAt === -1 ? "" : tail.slice(queryAt + 1);

    // lastIndexOf, so an unencoded "@" inside a password still splits at the
    // real separator, the one immediately before the host.
    const at = authority.lastIndexOf("@");
    const userInfo = at === -1 ? "" : authority.slice(0, at);
    const hostPart = at === -1 ? authority : authority.slice(at + 1);

    const colon = userInfo.indexOf(":");
    const user = this.decode(colon === -1 ? userInfo : userInfo.slice(0, colon), "the user name");
    const password = colon === -1 ? "" : this.decode(userInfo.slice(colon + 1), "the password");

    const hosts = this.parseHosts(hostPart, engine, scheme);
    const database = this.parseDatabase(path, engine);
    const { options, secretOptions } = this.parseQuery(query);

    return {
      engine: engine.engine,
      scheme: scheme.name,
      hosts,
      user,
      password,
      database,
      options,
      secretOptions,
    };
  }

  private parseHosts(
    hostPart: string,
    engine: EngineDescriptor,
    scheme: SchemeDescriptor
  ): HostAddress[] {
    if (!hostPart) {
      throw new InvalidConnectionUrlError("the host is missing.");
    }

    const hosts = hostPart.split(",").map((entry) => this.parseHost(entry, scheme));

    if (hosts.length > 1 && !engine.multipleHosts) {
      throw new InvalidConnectionUrlError(`${engine.label} URLs take a single host.`);
    }
    // An SRV record supplies the hosts and ports itself; a port in the URL is
    // rejected by every MongoDB driver, so it is rejected here with a clearer
    // message instead.
    if (scheme.defaultPort === 0 && hosts.some((entry) => entry.port !== 0)) {
      throw new InvalidConnectionUrlError(`${scheme.name} URLs must not include a port.`);
    }
    if (scheme.name === "mongodb+srv" && hosts.length > 1) {
      throw new InvalidConnectionUrlError("mongodb+srv URLs take a single host name.");
    }

    return hosts;
  }

  /** Accepts `host`, `host:port`, `[::1]` and `[::1]:port`. */
  private parseHost(entry: string, scheme: SchemeDescriptor): HostAddress {
    let host: string;
    let portText: string | undefined;

    if (entry.startsWith("[")) {
      const close = entry.indexOf("]");
      if (close === -1) {
        throw new InvalidConnectionUrlError("an IPv6 host is missing its closing bracket.");
      }
      host = entry.slice(1, close);
      const after = entry.slice(close + 1);
      portText = after.startsWith(":") ? after.slice(1) : undefined;
    } else {
      const colon = entry.lastIndexOf(":");
      host = colon === -1 ? entry : entry.slice(0, colon);
      portText = colon === -1 ? undefined : entry.slice(colon + 1);
    }

    if (!host) {
      throw new InvalidConnectionUrlError("the host is missing.");
    }

    return { host, port: portText === undefined ? scheme.defaultPort : this.parsePort(portText) };
  }

  private parsePort(text: string): number {
    const port = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new InvalidConnectionUrlError("the port must be a number from 1 to 65535.");
    }
    return port;
  }

  private parseDatabase(path: string, engine: EngineDescriptor): string {
    const trimmed = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) {
      return engine.defaultDatabase;
    }
    if (!engine.switchesDatabases) {
      throw new InvalidConnectionUrlError(`${engine.label} URLs do not take a database in the path.`);
    }
    return this.decode(trimmed, "the database name");
  }

  private parseQuery(query: string): {
    options: Record<string, string>;
    secretOptions: Record<string, string>;
  } {
    const options: Record<string, string> = {};
    const secretOptions: Record<string, string> = {};

    for (const [name, value] of new URLSearchParams(query)) {
      if (ConnectionUrlParser.SECRET_OPTION.test(name)) {
        secretOptions[name] = value;
      } else {
        options[name] = value;
      }
    }

    return { options, secretOptions };
  }

  private decode(value: string, what: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      throw new InvalidConnectionUrlError(`${what} contains malformed percent-encoding.`);
    }
  }

  private firstIndexOf(value: string, needles: string[]): number {
    const positions = needles.map((needle) => value.indexOf(needle)).filter((index) => index !== -1);
    return positions.length === 0 ? -1 : Math.min(...positions);
  }
}
