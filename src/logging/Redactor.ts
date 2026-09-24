/**
 * Removes credentials from tool arguments before they are logged.
 *
 * Always applied, with no switch to turn it off. The call log exists to show
 * what an assistant asked for, and a password is never part of that answer;
 * a log file is also exactly the kind of thing that ends up attached to an
 * issue or pasted into a chat.
 *
 * Two shapes are caught:
 *
 * - **An argument whose name looks like a secret** (`password`, `api_key`,
 *   `token`...), at any depth. The value is replaced outright.
 * - **A connection URL anywhere in a string**, whose password and whose
 *   secret-looking query parameters are masked. The URL is split the same way
 *   ConnectionUrlParser splits it, so what is masked is exactly what the
 *   parser would have used as the password.
 */
export class Redactor {
  public static readonly MASK = "***";

  /** The same test ConnectionUrlParser uses to keep secret options out of displayed strings. */
  private static readonly SECRET_NAME = /(pass|secret|token|api[_-]?key|credential)/i;

  private static readonly URL_START = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

  private static readonly MAX_DEPTH = 32;

  public redact(value: unknown, depth = 0): unknown {
    if (depth > Redactor.MAX_DEPTH) {
      return "[nested too deeply to log]";
    }
    if (typeof value === "string") {
      return this.redactUrl(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, depth + 1));
    }
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = Redactor.SECRET_NAME.test(key) && child !== "" && child != null
          ? Redactor.MASK
          : this.redact(child, depth + 1);
      }
      return out;
    }
    return value;
  }

  /**
   * `scheme://user:password@host/db?api_key=...` becomes
   * `scheme://user:***@host/db?api_key=***`. Anything not shaped like a URL
   * is returned unchanged.
   */
  public redactUrl(text: string): string {
    const scheme = Redactor.URL_START.exec(text);
    if (!scheme) {
      return text;
    }

    const prefix = scheme[0];
    const rest = text.slice(prefix.length);
    const authorityEnd = this.firstIndexOf(rest, ["/", "?", "#"]);
    const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
    const tail = authorityEnd === -1 ? "" : rest.slice(authorityEnd);

    return `${prefix}${this.maskUserInfo(authority)}${this.maskQuery(tail)}`;
  }

  private maskUserInfo(authority: string): string {
    const at = authority.lastIndexOf("@");
    if (at === -1) {
      return authority;
    }
    const userInfo = authority.slice(0, at);
    const colon = userInfo.indexOf(":");
    if (colon === -1 || colon === userInfo.length - 1) {
      return authority;
    }
    return `${userInfo.slice(0, colon + 1)}${Redactor.MASK}${authority.slice(at)}`;
  }

  private maskQuery(tail: string): string {
    const queryAt = tail.indexOf("?");
    if (queryAt === -1) {
      return tail;
    }
    const hashAt = tail.indexOf("#", queryAt);
    const query = tail.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt);
    const masked = query
      .split("&")
      .map((pair) => {
        const equals = pair.indexOf("=");
        const name = equals === -1 ? pair : pair.slice(0, equals);
        return equals !== -1 && Redactor.SECRET_NAME.test(name) ? `${name}=${Redactor.MASK}` : pair;
      })
      .join("&");
    return `${tail.slice(0, queryAt + 1)}${masked}${hashAt === -1 ? "" : tail.slice(hashAt)}`;
  }

  private firstIndexOf(value: string, needles: string[]): number {
    const positions = needles.map((needle) => value.indexOf(needle)).filter((index) => index !== -1);
    return positions.length === 0 ? -1 : Math.min(...positions);
  }
}
