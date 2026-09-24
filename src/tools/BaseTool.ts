import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { ToolResponse } from "../formatting/ToolResponse.js";
import { SilentObserver, type ToolCallObserver } from "../logging/ToolCallObserver.js";
import type { ToolResult } from "../types/tool.types.js";

/**
 * The annotations every tool must declare, with nothing optional.
 *
 * The SDK's `ToolAnnotations` makes every field optional, because the
 * specification does. This project does not: a human-readable `title` and all
 * four hints are required, since the OpenAI directory rejects a tool missing
 * any hint and a client falls back to the raw snake_case name without a title.
 */
export type ToolHints = Required<
  Pick<
    ToolAnnotations,
    "title" | "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint"
  >
>;

/**
 * Template Method base for every tool.
 *
 * `register` and `invoke` are fixed; subclasses supply only `execute`. That
 * makes the error contract impossible to forget, which matters because an MCP
 * server that throws out of a handler can take the client's whole session with
 * it.
 */
export abstract class BaseTool<TArgs = Record<string, unknown>> {
  /** The name the assistant calls. Must be unique across the server. */
  public abstract readonly name: string;

  /**
   * Written for a language model, not a person: it is the only thing telling
   * the assistant when to reach for this tool. `use_database` ends with "no
   * restart needed" precisely so an assistant does not tell the user to
   * restart.
   */
  public abstract readonly description: string;

  public abstract readonly inputSchema: ZodRawShape;

  /**
   * What the client is allowed to assume before it runs the call.
   *
   * Every reading tool is incapable of changing anything, so a client may run
   * it without stopping to ask. The validators and each driver's server-side
   * read-only mode are what make that true; this is what says so out loud,
   * and a client that never hears it has to treat `run_query` as if it might
   * drop a table.
   *
   * `openWorldHint` is true throughout because the answers come from a database
   * server, not from a closed set this process controls.
   *
   * All four hints are stated explicitly, including the two the specification
   * treats as meaningful only when `readOnlyHint` is false. An omitted hint is
   * indistinguishable from an unconsidered one: a client, a directory or an
   * auditor reading a partial set cannot tell "this tool is not destructive"
   * from "nobody said". Spelling out the redundant pair costs two lines and
   * removes that ambiguity.
   *
   * Abstract, with no default. In the MySQL-only predecessor this was once a
   * default that most tools inherited, which was correct on the wire but
   * invisible in each tool's own file: directory scanners that read source
   * (M8ven among them) reported those tools as missing every hint. Each tool
   * states its own four next to its name, so the file a reviewer opens is the
   * whole answer, and the `ToolHints` type makes leaving one out a compile
   * error rather than a CI failure.
   */
  public abstract readonly annotations: ToolHints;

  protected abstract execute(args: TArgs): Promise<ToolResult>;

  /**
   * The cast is confined to this one line: the SDK derives the callback's
   * argument type from the schema it was given, which it cannot do for a
   * schema held in an abstract property. Every subclass declares its own
   * argument interface, so the type is recovered immediately below.
   *
   * The observer sees the call from outside `invoke`, so it receives the
   * final result, error results included, and a tool cannot opt out of it
   * any more than it can opt out of the error contract. When call logging is
   * off it is a SilentObserver and adds nothing.
   */
  public register(server: McpServer, observer: ToolCallObserver = new SilentObserver()): void {
    server.registerTool(
      this.name,
      {
        // Sent at the top level as well as inside the annotations: newer
        // clients read the top-level field, older ones only the annotation.
        title: this.annotations.title,
        description: this.description,
        inputSchema: this.inputSchema,
        annotations: this.annotations,
      },
      (args: Record<string, unknown>) => observer.observe(this.name, args, () => this.invoke(args as TArgs))
    );
  }

  /**
   * The one place a thrown error becomes a tool error.
   *
   * A dropped connection, a syntax error or an unconfigured server all
   * arrive here and leave as readable text, so the process stays alive and the
   * user can simply try again.
   */
  private async invoke(args: TArgs): Promise<ToolResult> {
    try {
      return await this.execute(args);
    } catch (error) {
      return ToolResponse.failure(error instanceof Error ? error.message : String(error));
    }
  }
}
