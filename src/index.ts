#!/usr/bin/env node
import { ApplicationFactory } from "./ApplicationFactory.js";

/**
 * Entry point. Nothing but construction and start.
 *
 * With no arguments, which is how every MCP client runs it, this is the MCP
 * server. `viewer` runs the standalone live log viewer instead; it is loaded
 * only then, so it costs the MCP server's startup nothing.
 *
 * For the MCP server there is no configuration check and no exit path here,
 * on purpose. A server with no usable connection still starts, still answers
 * tools/list, and reports the problem through tool results. An MCP client
 * cannot show a stderr message from a process that exited during handshake;
 * it reports "server failed to start", which is indistinguishable from a
 * broken image or a wrong path. A running server that says "call connect" is
 * diagnosable, and usually fixable in the same conversation.
 */
const [command, ...rest] = process.argv.slice(2);

if (command === "viewer") {
  const { ViewerCommand } = await import("./cli/ViewerCommand.js");
  process.exit(await new ViewerCommand().run(rest));
}

const application = new ApplicationFactory();
await application.create().start();
