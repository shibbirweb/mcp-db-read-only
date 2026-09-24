import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { JsonSerializer } from "../../formatting/JsonSerializer.js";
import type { BackgroundService } from "../../server/BackgroundService.js";
import { Paging, type LogStore, type StoredEntry } from "../store/LogStore.js";
import { ViewerAssets } from "./ViewerAssets.js";

/** Whether the viewer is serving, and if not, why. */
export type ViewerStatus =
  | { readonly state: "idle" }
  | { readonly state: "running"; readonly url: string }
  | { readonly state: "unavailable"; readonly port: number; readonly reason: string };

/** Names whatever is listening on a port, or null when that cannot be found out. */
export type PortOwnerLookup = (port: number) => Promise<string | null>;

/**
 * `lsof`, present on macOS and most Linux hosts. Absent in the Alpine image,
 * where the message simply says the port is in use without naming anyone.
 */
export const lsofPortOwner: PortOwnerLookup = (port) =>
  new Promise((resolve) => {
    execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { timeout: 2000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const pid = /^p(\d+)$/m.exec(stdout)?.[1];
      const command = /^c(.+)$/m.exec(stdout)?.[1];
      resolve(pid ? `${command ?? "a process"} (pid ${pid})` : null);
    });
  });

/**
 * The live log viewer: a page in the browser listing logged calls, a page at
 * a time, newest first, and updating as new ones arrive.
 *
 * It reads a LogStore: the permanent log folder when DB_LOG_DIR is set, which
 * holds the calls of every copy of the server sharing it, or this process's
 * recent calls in memory otherwise. It never sees a record that has not been
 * through the redactor, because the stores only ever hold what the call
 * logger produced.
 *
 * It serves, read-only, with Node's own `http` module:
 *
 * - `/`, `/viewer.js`, `/viewer.css`: the page, self-contained, fetching
 *   nothing from anywhere else;
 * - `/api/entries?page=&size=&tool=&failed=1&q=`: one page of entries, with
 *   the filters applied across everything stored;
 * - `/api/tools`: the tool names present, for the tool filter;
 * - `/events`: Server-Sent Events announcing each new entry.
 *
 * It binds its port **on the first tool call, not at startup**. An MCP client
 * such as Claude Desktop starts one copy of the server per chat surface, and
 * most of those copies never receive a call. Binding lazily means the copy
 * actually in use gets the port, and idle copies never hold one.
 *
 * It must never become the reason the process misbehaves:
 *
 * - **A port that is taken is reported, not fatal.** `ensureRunning` returns
 *   why, naming the process that holds the port where it can, and every
 *   later call retries, so freeing the port brings the viewer up without a
 *   restart.
 * - **It never keeps the process alive.** The listening socket and every
 *   connected browser are unref'd, so the process lives exactly as long as it
 *   would with no viewer. Without this, a client that died without sending
 *   SIGTERM would leave an orphan holding the port, and the next session's
 *   viewer would find it taken.
 */
export class LiveLogViewer implements BackgroundService {
  /** Keeps idle connections open through proxies and sleeping laptops. */
  private static readonly HEARTBEAT_MS = 15000;

  private readonly clients = new Set<ServerResponse>();
  private server: Server | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private current: ViewerStatus = { state: "idle" };
  private binding: Promise<ViewerStatus> | null = null;
  private stopped = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly store: LogStore,
    private readonly logger: (message: string) => void,
    private readonly portOwner: PortOwnerLookup = lsofPortOwner,
    private readonly assets: ViewerAssets = new ViewerAssets(),
    private readonly serializer: JsonSerializer = new JsonSerializer()
  ) {}

  public get status(): ViewerStatus {
    return this.current;
  }

  /** The port actually bound, which differs from the requested one only when that was 0. */
  public get boundPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? (address as AddressInfo).port : null;
  }

  /** Binding is deferred to the first tool call; see the class comment. */
  public async start(): Promise<void> {
    return;
  }

  /**
   * Serve, if not already serving. Called before every tool call; cheap once
   * running, and a quick retry while the port is taken. Never throws.
   * Concurrent calls share one attempt.
   */
  public ensureRunning(): Promise<ViewerStatus> {
    if (this.stopped || this.current.state === "running") {
      return Promise.resolve(this.current);
    }
    if (!this.binding) {
      this.binding = this.bind().finally(() => {
        this.binding = null;
      });
    }
    return this.binding;
  }

  /**
   * Keep the process alive for as long as the viewer listens. Only the
   * standalone `viewer` command wants this; inside an MCP server the viewer
   * must never be what keeps the process running.
   */
  public holdProcessOpen(): void {
    this.server?.ref();
  }

  /** Never throws: shutdown calls it. */
  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.store.stop();
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async bind(): Promise<ViewerStatus> {
    const server = createServer((request, response) => void this.handle(request, response));

    const failure = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      server.once("error", (error: NodeJS.ErrnoException) => resolve(error));
      server.listen(this.port, this.host, () => resolve(null));
    });

    if (failure) {
      server.close();
      this.current = { state: "unavailable", port: this.port, reason: await this.describeFailure(failure) };
      return this.current;
    }

    server.unref();
    server.on("error", (error) => this.logger(`live log viewer: ${error.message}`));
    this.server = server;

    this.store.start();
    this.unsubscribe = this.store.subscribe((entry) => this.broadcast(this.frame(entry)));

    this.heartbeat = setInterval(() => this.broadcast(": heartbeat\n\n"), LiveLogViewer.HEARTBEAT_MS);
    this.heartbeat.unref();

    this.current = { state: "running", url: `http://${this.displayHost()}:${this.boundPort}/` };

    // Said plainly, because with no access control anyone who can reach
    // this address can read every query and every result.
    this.logger(
      `live log viewer at ${this.current.url} (listening on ${this.host}, no access control: anyone who can reach this port can read the full call log)`
    );
    return this.current;
  }

  private async describeFailure(error: NodeJS.ErrnoException): Promise<string> {
    if (error.code !== "EADDRINUSE") {
      return `port ${this.port} could not be opened: ${error.message}`;
    }
    const owner = await this.portOwner(this.port).catch(() => null);
    return owner ? `port ${this.port} is used by ${owner}` : `port ${this.port} is already in use`;
  }

  private broadcast(frame: string): void {
    for (const client of this.clients) {
      client.write(frame);
    }
  }

  /**
   * One SSE message. The data is compact JSON, which escapes every newline
   * inside its strings, so it is always a single `data:` line and cannot be
   * split or spoofed by content containing blank lines.
   */
  private frame(entry: StoredEntry): string {
    return `event: entry\ndata: ${this.serializer.stringify(entry, 0)}\n\n`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // Reads only. Nothing on this server accepts input.
    if (request.method !== "GET" && request.method !== "HEAD") {
      this.send(response, 405, "text/plain; charset=utf-8", "Method not allowed", { allow: "GET, HEAD" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://viewer.invalid");
    try {
      switch (url.pathname) {
        case "/":
          this.send(response, 200, "text/html; charset=utf-8", this.assets.html);
          return;
        case "/viewer.js":
          this.send(response, 200, "text/javascript; charset=utf-8", this.assets.script);
          return;
        case "/viewer.css":
          this.send(response, 200, "text/css; charset=utf-8", this.assets.stylesheet);
          return;
        case "/api/entries":
          this.sendJson(response, await this.store.query(this.parseQuery(url.searchParams)));
          return;
        case "/api/tools":
          this.sendJson(response, { tools: await this.store.tools() });
          return;
        case "/events":
          this.subscribe(request, response);
          return;
        default:
          this.send(response, 404, "text/plain; charset=utf-8", "Not found");
      }
    } catch (error) {
      this.send(response, 500, "text/plain; charset=utf-8", `Could not read the log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parseQuery(params: URLSearchParams): Parameters<LogStore["query"]>[0] {
    return {
      page: Number(params.get("page") ?? 1),
      size: Number(params.get("size") ?? Paging.DEFAULT_SIZE),
      tool: params.get("tool") || undefined,
      failedOnly: params.get("failed") === "1",
      text: params.get("q") || undefined,
    };
  }

  private subscribe(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(200, {
      ...this.securityHeaders(),
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.socket?.unref();

    // Tell the browser to retry after 2 s if the server restarts.
    response.write("retry: 2000\n\nevent: ready\ndata: {}\n\n");
    this.clients.add(response);
    request.on("close", () => this.clients.delete(response));
  }

  private sendJson(response: ServerResponse, value: unknown): void {
    this.send(response, 200, "application/json; charset=utf-8", this.serializer.stringify(value, 0));
  }

  private send(
    response: ServerResponse,
    status: number,
    contentType: string,
    body: string,
    extra: Record<string, string> = {}
  ): void {
    response.writeHead(status, { ...this.securityHeaders(), "content-type": contentType, ...extra });
    response.end(body);
  }

  /**
   * The page runs with a policy allowing only its own script, stylesheet,
   * API and event stream, so even a result that somehow reached the page as
   * markup could not load or run anything.
   */
  private securityHeaders(): Record<string, string> {
    return {
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    };
  }

  /** 0.0.0.0 is where it listens, not an address a browser can open. */
  private displayHost(): string {
    return this.host === "0.0.0.0" || this.host === "::" ? "127.0.0.1" : this.host;
  }
}
