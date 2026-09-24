import type { ToolResult } from "../types/tool.types.js";

/**
 * Sees every tool call on its way through BaseTool.
 *
 * `run` never throws, because BaseTool has already turned every failure into
 * a tool result by the time it is handed over, and an observer must not throw
 * either: a problem with logging must never become a problem with the call.
 */
export interface ToolCallObserver {
  observe(tool: string, args: unknown, run: () => Promise<ToolResult>): Promise<ToolResult>;
}

/** The observer when logging is off. */
export class SilentObserver implements ToolCallObserver {
  public observe(_tool: string, _args: unknown, run: () => Promise<ToolResult>): Promise<ToolResult> {
    return run();
  }
}
