import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(here, "../../dist/index.js");

/**
 * Minimal MCP client over stdio.
 *
 * Deliberately sends one request at a time and waits for its response before
 * sending the next. Requests written in a batch are answered concurrently, so a
 * `use_database` batched next to a `run_query` is not ordered against it, and
 * tests written that way fail in confusing, intermittent ways.
 */
export class McpClient {
  constructor(env = {}) {
    this.proc = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.stderr = "";

    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          this.#dispatch(line);
        }
        newline = this.buffer.indexOf("\n");
      }
    });
  }

  #dispatch(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const resolver = this.pending.get(message.id);
    if (resolver) {
      this.pending.delete(message.id);
      resolver(message);
    }
  }

  #request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}\nstderr:\n${this.stderr}`));
      }, 30000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    return answer;
  }

  #notify(method, params) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize() {
    const message = await this.#request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    this.#notify("notifications/initialized", {});
    return message.result;
  }

  async listTools() {
    const message = await this.#request("tools/list", {});
    return message.result.tools;
  }

  /** Returns { text, isError } with every text block joined. */
  async call(name, args = {}) {
    const message = await this.#request("tools/call", { name, arguments: args });
    if (message.error) {
      return { text: message.error.message ?? "", isError: true };
    }
    const result = message.result ?? {};
    const text = (result.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    return { text, isError: Boolean(result.isError) };
  }

  async close() {
    // The server holds drivers open and only shuts down on a signal, so closing
    // stdin is not enough to make it exit.
    this.proc.kill("SIGTERM");
    await new Promise((resolve) => {
      this.proc.once("exit", resolve);
      setTimeout(() => {
        this.proc.kill("SIGKILL");
        resolve();
      }, 5000);
    });
  }
}
