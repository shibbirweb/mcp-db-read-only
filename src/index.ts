#!/usr/bin/env node
import { ApplicationFactory } from "./ApplicationFactory.js";

/**
 * Entry point. Nothing but construction and start.
 *
 * There is no configuration check and no exit path here on purpose. A server
 * with no usable connection still starts, still answers tools/list, and
 * reports the problem through tool results. An MCP client cannot show a stderr
 * message from a process that exited during handshake; it reports "server
 * failed to start", which is indistinguishable from a broken image or a wrong
 * path. A running server that says "call connect" is diagnosable, and usually
 * fixable in the same conversation.
 */
const application = new ApplicationFactory();
await application.create().start();
