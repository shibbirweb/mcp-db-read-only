import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { FolderLogStore } from "../logging/store/FolderLogStore.js";
import { LiveLogViewer } from "../logging/viewer/LiveLogViewer.js";

/** What `viewer` was asked to do, after parsing. */
export interface ViewerOptions {
  readonly directory: string;
  readonly port: number;
  readonly host: string;
}

/** The outcome of parsing: options to run with, or text to print and an exit code. */
export type ParsedViewerArgs =
  | { readonly kind: "run"; readonly options: ViewerOptions }
  | { readonly kind: "exit"; readonly code: number; readonly message: string };

/** Where the command writes. Injected so tests can capture both streams. */
export interface ConsoleOutput {
  out(message: string): void;
  error(message: string): void;
}

/**
 * `mcp-db-read-only viewer --dir <folder> [--port 4800] [--host 0.0.0.0]`
 *
 * The live log viewer on its own, with no MCP server, no database and no
 * credentials: it only reads the log folder that MCP servers configured with
 * DB_LOG_DIR write into, and serves the same page as DB_LOG_PORT does.
 *
 * Run separately, in a terminal, so the servers an MCP client starts stay as
 * light as they can be and never compete for a port. It shows the calls of
 * every copy of the server writing to the folder, across restarts.
 *
 * Unlike the in-server viewer, it binds at once and exits if it cannot: here
 * a person is watching the terminal, so a clear error and a non-zero exit is
 * the useful answer to a taken port, where inside an MCP server it would have
 * cost the chat its tools.
 */
export class ViewerCommand {
  public static readonly DEFAULT_PORT = 4800;
  public static readonly DEFAULT_HOST = "0.0.0.0";

  public static readonly USAGE = [
    "Usage: mcp-db-read-only viewer --dir <folder> [--port <port>] [--host <address>]",
    "",
    "Serves the live log viewer for a log folder written by MCP servers run with DB_LOG_DIR.",
    "",
    `  --dir, -d    The log folder (required; DB_LOG_DIR is used when omitted)`,
    `  --port, -p   Port to listen on (default ${ViewerCommand.DEFAULT_PORT})`,
    `  --host       Address to listen on (default ${ViewerCommand.DEFAULT_HOST}, every interface)`,
    "  --help, -h   Show this help",
    "",
    "The viewer has no access control: anyone who can reach the port can read the log.",
  ].join("\n");

  constructor(
    private readonly output: ConsoleOutput = {
      out: (message) => process.stdout.write(`${message}\n`),
      error: (message) => process.stderr.write(`${message}\n`),
    },
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  /** Pure: argument text in, options or an exit out. */
  public parse(args: readonly string[]): ParsedViewerArgs {
    let directory = this.env.DB_LOG_DIR ?? "";
    let port = ViewerCommand.DEFAULT_PORT;
    let host = ViewerCommand.DEFAULT_HOST;

    for (let index = 0; index < args.length; index += 1) {
      const [flag, inline] = args[index].split(/=(.*)/s, 2);
      const value = (): string | undefined => inline ?? args[++index];

      switch (flag) {
        case "--help":
        case "-h":
          return { kind: "exit", code: 0, message: ViewerCommand.USAGE };
        case "--dir":
        case "-d":
          directory = value() ?? "";
          break;
        case "--port":
        case "-p": {
          const text = value() ?? "";
          const parsed = Number(text);
          if (!/^\d+$/.test(text) || parsed < 1 || parsed > 65535) {
            return { kind: "exit", code: 2, message: `--port must be a number from 1 to 65535, got "${text}".\n\n${ViewerCommand.USAGE}` };
          }
          port = parsed;
          break;
        }
        case "--host":
          host = value() ?? "";
          break;
        default:
          return { kind: "exit", code: 2, message: `Unknown option "${args[index]}".\n\n${ViewerCommand.USAGE}` };
      }
    }

    if (!directory) {
      return { kind: "exit", code: 2, message: `--dir is required: the folder your MCP servers write with DB_LOG_DIR.\n\n${ViewerCommand.USAGE}` };
    }
    if (!host) {
      return { kind: "exit", code: 2, message: `--host needs an address.\n\n${ViewerCommand.USAGE}` };
    }
    return { kind: "run", options: { directory: resolve(directory), port, host } };
  }

  /** @returns the exit code: 0 after a clean shutdown, non-zero when it could not start. */
  public async run(args: readonly string[]): Promise<number> {
    const parsed = this.parse(args);
    if (parsed.kind === "exit") {
      (parsed.code === 0 ? this.output.out : this.output.error)(parsed.message);
      return parsed.code;
    }

    const { directory, port, host } = parsed.options;
    // Created if missing, owner-only, so the viewer can be started before the
    // first call is ever logged.
    mkdirSync(directory, { recursive: true, mode: 0o700 });

    const viewer = new LiveLogViewer(host, port, new FolderLogStore(directory), (message) => this.output.out(message));
    const status = await viewer.ensureRunning();
    if (status.state !== "running") {
      const reason = status.state === "unavailable" ? status.reason : "it could not start";
      this.output.error(`Could not start the viewer: ${reason}. Free that port, or choose another with --port.`);
      await viewer.stop();
      return 1;
    }

    // The in-server viewer never holds its process open; here it is the
    // whole point of the process.
    viewer.holdProcessOpen();
    this.output.out(`Reading ${directory}. Press Ctrl+C to stop.`);

    return new Promise<number>((done) => {
      const stop = () => {
        void viewer.stop().then(() => done(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
  }
}
