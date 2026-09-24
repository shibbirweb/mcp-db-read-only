/** Sends one raw command. Satisfied by ioredis's `call`, and by a fake in tests. */
export type RedisCaller = (command: string, ...args: string[]) => Promise<unknown>;

/**
 * Asks the Redis server whether a command is read-only before it is sent.
 *
 * Layer two for Redis. The tool-level allowlist is a list written in this
 * repository; this is the server's own classification of its commands, as
 * reported by COMMAND INFO. A command is sent only if the server flags it
 * `readonly` and does not flag it `write`. The two layers are independent: a
 * command wrongly added to the allowlist is still refused here, and a server
 * whose flags differ from what the allowlist assumed is caught too.
 *
 * It fails closed. When COMMAND itself is unavailable, renamed or denied by an
 * ACL, the command is refused with a message saying why, rather than sent on
 * the strength of the allowlist alone.
 */
export class RedisCommandFlagsGuard {
  private readonly cache = new Map<string, readonly string[]>();

  /**
   * @param name the canonical upper-case command
   * @param subcommand for container commands such as OBJECT ENCODING
   * @throws Error when the server does not confirm the command is read-only
   */
  public async assertReadOnly(call: RedisCaller, name: string, subcommand?: string): Promise<void> {
    const flags = await this.flagsFor(call, name, subcommand);
    const readOnly = flags.includes("readonly") && !flags.includes("write");
    if (!readOnly) {
      const label = subcommand ? `${name} ${subcommand}` : name;
      throw new Error(
        `The server does not flag ${label} as read-only (flags: ${flags.join(", ") || "none"}), so it was not sent.`
      );
    }
  }

  private async flagsFor(call: RedisCaller, name: string, subcommand?: string): Promise<readonly string[]> {
    const key = subcommand ? `${name}|${subcommand}` : name;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    let reply: unknown;
    try {
      // Redis 7 answers `container|subcommand` directly; older servers only
      // know the container, whose flags then stand for all its subcommands.
      reply = await call("COMMAND", "INFO", subcommand ? `${name.toLowerCase()}|${subcommand.toLowerCase()}` : name);
      if (subcommand && this.isEmpty(reply)) {
        reply = await call("COMMAND", "INFO", name);
      }
    } catch (error) {
      throw new Error(
        `Could not confirm ${name} is read-only because COMMAND INFO failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const flags = this.parseFlags(reply);
    if (!flags) {
      throw new Error(`The server does not know the command ${name}.`);
    }
    this.cache.set(key, flags);
    return flags;
  }

  /** COMMAND INFO replies `[[name, arity, [flags...], ...]]`, or `[null]` for an unknown command. */
  private parseFlags(reply: unknown): string[] | null {
    if (!Array.isArray(reply) || !Array.isArray(reply[0])) {
      return null;
    }
    const flags = reply[0][2];
    if (!Array.isArray(flags)) {
      return null;
    }
    return flags.map((flag) => String(flag).toLowerCase());
  }

  private isEmpty(reply: unknown): boolean {
    return !Array.isArray(reply) || reply[0] === null || reply[0] === undefined;
  }
}
