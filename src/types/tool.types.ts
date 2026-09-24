/**
 * A single text block of MCP tool output.
 *
 * The open index signature is required by the SDK's content union, which
 * allows extra fields on every block type.
 */
export interface ToolTextContent {
  readonly type: "text";
  readonly text: string;
  readonly [key: string]: unknown;
}

/** The shape an MCP tool handler must return. */
export interface ToolResult {
  readonly content: ToolTextContent[];
  readonly isError?: boolean;
  /** Present so the result satisfies the SDK's open-ended result type. */
  readonly [key: string]: unknown;
}

/** Arguments shared by every tool that can read from a one-off database. */
export interface DatabaseScopedArgs {
  readonly database?: string;
}
