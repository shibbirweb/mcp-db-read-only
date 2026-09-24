import type { ToolResult } from "../../types/tool.types.js";
import type { ToolCallObserver } from "../ToolCallObserver.js";
import type { ViewerStatus } from "./LiveLogViewer.js";

/** What this observer needs from the viewer: bring it up, and say how it went. */
export interface ViewerStarter {
  ensureRunning(): Promise<ViewerStatus>;
}

/**
 * Brings the live viewer up on the first tool call, and says so when it cannot.
 *
 * A decorator around the call logger's observer. Before each call it asks the
 * viewer to be running, so the call itself appears in the page, and a port
 * freed since the last attempt is picked up without a restart.
 *
 * The person using the chat is told, in the tool result itself, twice at most:
 *
 * - **the first time the port is unavailable**, with who holds it and what
 *   to do about it, since otherwise the viewer silently shows nothing;
 * - **when it comes up after having been unavailable**, with its URL.
 *
 * Both go to the diagnostic log as well. Later failures while the port stays
 * taken are not repeated in the chat, where the same line on every result
 * would be noise the model has to read past.
 */
export class LiveViewerObserver implements ToolCallObserver {
  private lastState: ViewerStatus["state"] = "idle";
  private toldUnavailable = false;

  constructor(
    private readonly inner: ToolCallObserver,
    private readonly viewer: ViewerStarter,
    /** Where calls are still going while the viewer is down, e.g. "stderr". */
    private readonly fallback: string,
    private readonly logger: (message: string) => void
  ) {}

  public async observe(tool: string, args: unknown, run: () => Promise<ToolResult>): Promise<ToolResult> {
    const status = await this.viewer.ensureRunning().catch((): ViewerStatus => ({ state: "idle" }));
    const notice = this.noticeFor(status);
    const result = await this.inner.observe(tool, args, run);
    if (!notice) {
      return result;
    }
    return { ...result, content: [...result.content, { type: "text", text: notice }] };
  }

  /** @returns a line for the chat, or null. Logs every change of state either way. */
  private noticeFor(status: ViewerStatus): string | null {
    const previous = this.lastState;
    this.lastState = status.state;

    if (status.state === "unavailable") {
      const message = `Live log viewer unavailable: ${status.reason}. Free that port, or set DB_LOG_PORT to another one. Calls are still logged to ${this.fallback}; the viewer starts on the next call once the port is free.`;
      if (previous !== "unavailable") {
        this.logger(message);
      }
      if (!this.toldUnavailable) {
        this.toldUnavailable = true;
        return `[mcp-db-read-only] ${message}`;
      }
      return null;
    }

    if (status.state === "running" && previous === "unavailable") {
      return `[mcp-db-read-only] Live log viewer is now running at ${status.url}`;
    }
    return null;
  }
}
