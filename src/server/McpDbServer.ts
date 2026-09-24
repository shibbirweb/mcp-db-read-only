import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BaseTool } from "../tools/BaseTool.js";
import { DriverCache } from "../drivers/DriverCache.js";

/**
 * Owns the MCP server's lifetime.
 *
 * Takes tools as an already-constructed list rather than building them, so
 * this class knows nothing about databases or about which tools exist. Wiring
 * is the composition root's job; running is this one's.
 */
export class McpDbServer {
  private readonly server: McpServer;
  private shuttingDown = false;

  /**
   * `version` is required and has no default on purpose: a default here is a
   * second place to remember at release time, and the one that silently wins
   * when it is forgotten. The composition root reads it from `package.json`.
   */
  constructor(
    private readonly tools: BaseTool<never>[],
    private readonly drivers: DriverCache,
    private readonly logger: (message: string) => void,
    version: string,
    name = "db-readonly-switchable"
  ) {
    this.server = new McpServer({ name, version });
  }

  public async start(): Promise<void> {
    // Registered before the transport connects, so a tools/list arriving
    // immediately after the handshake can be answered.
    for (const tool of this.tools) {
      tool.register(this.server);
    }

    this.installSignalHandlers();

    await this.server.connect(new StdioServerTransport());

    // stderr, always. On stdio transport stdout carries JSON-RPC and a single
    // stray byte corrupts the stream.
    this.logger("MCP database server running (read-only, switchable connection)");
  }

  /**
   * Only signals, deliberately.
   *
   * Once a query has run a driver holds open sockets, and open handles keep
   * the Node event loop alive, so the process cannot exit on its own. That
   * makes it tempting to shut down when stdin closes. It is a trap, found the
   * hard way in the MySQL-only predecessor: stdin `end` fires when no further
   * requests are *buffered*, not when the client has gone. A client that
   * writes several requests and waits reaches EOF while they are still being
   * processed, so connections were torn down mid-flight and every later call
   * failed.
   *
   * SIGTERM is what a client sends when it is genuinely finished.
   */
  private installSignalHandlers(): void {
    const shutdown = () => {
      void this.shutdown();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  /** Idempotent, so a repeated signal cannot tear down drivers twice at once. */
  public async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    await this.drivers.closeAll();
    process.exit(0);
  }
}
