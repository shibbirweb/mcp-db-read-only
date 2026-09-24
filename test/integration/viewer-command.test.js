import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { McpClient } from "../helpers/client.js";
import { freePort, readEvents } from "../helpers/sse.js";

const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");

/** Starts `viewer` as its own process and resolves once it prints its URL, or exits. */
function startViewer(args) {
  const proc = spawn(process.execPath, [entry, "viewer", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  proc.stdout.on("data", (chunk) => (out += chunk));
  proc.stderr.on("data", (chunk) => (err += chunk));
  const ready = new Promise((resolveReady) => {
    const check = setInterval(() => {
      if (out.includes("Press Ctrl+C")) {
        clearInterval(check);
        resolveReady("running");
      }
    }, 50);
    proc.once("exit", (code) => {
      clearInterval(check);
      resolveReady(`exited ${code}`);
    });
  });
  return { proc, ready, output: () => ({ out, err }) };
}

function stop(proc) {
  return new Promise((resolveStop) => {
    if (proc.exitCode !== null) {
      resolveStop(proc.exitCode);
      return;
    }
    proc.once("exit", (code) => resolveStop(code));
    proc.kill("SIGTERM");
  });
}

describe("mcp-db-read-only viewer, run on its own", () => {
  let directory;
  let databaseUrl;
  let port;
  let viewer;
  let server;

  before(async () => {
    directory = mkdtempSync(join(tmpdir(), "mcp-db-ro-viewer-"));
    const path = join(directory, "app.db");
    const database = new DatabaseSync(path);
    database.exec("CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO members (name) VALUES ('Ada');");
    database.close();
    databaseUrl = `sqlite://${path}`;

    port = await freePort();
    viewer = startViewer(["--dir", join(directory, "logs"), "--port", String(port)]);
    assert.equal(await viewer.ready, "running", viewer.output().err);

    // The MCP server as Claude would run it: logging to the folder, no port.
    server = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "", DB_LOG_FILE: "", DB_LOG_PORT: "", DB_LOG_DIR: join(directory, "logs") });
    await server.initialize();
  });

  after(async () => {
    await server.close();
    await stop(viewer.proc);
    rmSync(directory, { recursive: true, force: true });
  });

  test("prints its URL and the access warning", () => {
    assert.match(viewer.output().out, new RegExp(`live log viewer at http://127\\.0\\.0\\.1:${port}/`));
    assert.match(viewer.output().out, /no access control/);
  });

  test("the MCP server holds no port and starts no viewer of its own", () => {
    assert.doesNotMatch(server.stderr, /live log viewer/);
  });

  test("a call made by the MCP server appears in the separate viewer, live", async () => {
    const reading = readEvents(`http://127.0.0.1:${port}/events`, (seen) => seen.some((event) => event.event === "entry"), 8000);
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    await server.call("run_query", { query: "SELECT name FROM members" });

    const pushed = (await reading).find((event) => event.event === "entry");
    assert.ok(pushed, "no entry event arrived");
    assert.equal(pushed.data.data.tool, "run_query");

    const page = await (await fetch(`http://127.0.0.1:${port}/api/entries`)).json();
    assert.match(page.entries[0].data.output, /Ada/);
  });

  test("Ctrl+C (SIGINT) stops it cleanly", async () => {
    const second = startViewer(["--dir", join(directory, "logs"), "--port", String(await freePort())]);
    assert.equal(await second.ready, "running");
    const exited = new Promise((resolveExit) => second.proc.once("exit", resolveExit));
    second.proc.kill("SIGINT");
    assert.equal(await exited, 0);
  });
});

describe("a taken port", () => {
  test("exits with a clear error instead of running without the page", async () => {
    const blocker = createServer();
    await new Promise((resolveListen) => blocker.listen(0, "0.0.0.0", resolveListen));
    const directory = mkdtempSync(join(tmpdir(), "mcp-db-ro-viewer-"));
    try {
      const viewer = startViewer(["--dir", directory, "--port", String(blocker.address().port)]);
      assert.equal(await viewer.ready, "exited 1");
      assert.match(viewer.output().err, /Could not start the viewer: port \d+ (is used by|is already in use).*--port/);
    } finally {
      blocker.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
