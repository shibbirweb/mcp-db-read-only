import { readFileSync } from "node:fs";

/**
 * Reads the version clients see in the MCP handshake from `package.json`.
 *
 * A literal in the server class would mean a release has to remember to
 * change the same number in two files. Nothing enforces that, and the tag
 * check in the publish workflows never looks at a literal, so a missed bump
 * would ship a server that misreports itself to every client. The MySQL-only
 * predecessor of this server shipped exactly that bug before this class
 * existed.
 *
 * `package.json` is present in all three ways this server is distributed: the
 * npm tarball always includes it, the runtime image copies it in before the
 * build output, and a local checkout has it by definition.
 */
export class PackageVersionLoader {
  /**
   * Used when `package.json` cannot be read. A server that starts and reports
   * an obviously wrong version is easier to diagnose than one that refuses to
   * start over metadata it does not need in order to answer queries.
   */
  public static readonly UNKNOWN_VERSION = "0.0.0";

  /**
   * Resolved from this module rather than from `process.cwd()`, so the answer
   * does not depend on the directory the client happened to launch us from.
   */
  constructor(
    private readonly packageJsonUrl: URL = new URL("../../package.json", import.meta.url)
  ) {}

  public load(): string {
    try {
      const contents = readFileSync(this.packageJsonUrl, "utf8");
      const version = JSON.parse(contents).version;
      return typeof version === "string" && version.length > 0
        ? version
        : PackageVersionLoader.UNKNOWN_VERSION;
    } catch {
      return PackageVersionLoader.UNKNOWN_VERSION;
    }
  }
}
