import { ApplicationError } from "./ApplicationError.js";

/**
 * Raised when a query tool is called against an engine it does not speak.
 *
 * Every tool is advertised all the time, because MCP fixes the tool list at
 * handshake while the active engine changes mid-conversation. So `run_query`
 * can be called against MongoDB, and when it is, the most useful answer names
 * the tools that do work there.
 */
export class EngineMismatchError extends ApplicationError {
  constructor(
    toolName: string,
    supportedEngines: string,
    activeEngine: string,
    alternatives: readonly string[]
  ) {
    const instead =
      alternatives.length > 0 ? ` Use ${alternatives.join(", ")} for ${activeEngine}.` : "";
    super(
      `${toolName} works on ${supportedEngines} connections, but the active connection is ${activeEngine}.${instead}`
    );
  }
}
