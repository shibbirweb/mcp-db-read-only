import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { McpClient } from "../helpers/client.js";
import { freePort, readEvents } from "../helpers/sse.js";

/**
 * The call log through a real server process, against a SQLite file, so it
 * needs no database server and always runs.
 */
let directory = "";
let databaseUrl = "";

before(() => {
  directory = mkdtempSync(join(tmpdir(), "mcp-db-ro-log-"));
  const path = join(directory, "app.db");
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE members (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO members (name) VALUES ('Ada'), ('Grace');");
  database.close();
  databaseUrl = `sqlite://${path}`;
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("DB_LOG_FILE with DB_LOG_FORMAT=json", () => {
  let client;
  let logPath;
  let entries = [];

  before(async () => {
    logPath = join(directory, "calls.log");
    client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG_FILE: logPath, DB_LOG_FORMAT: "json", DB_CONNECT_TIMEOUT_MS: "1500" });
    await client.initialize();
    await client.call("run_query", { query: "SELECT name FROM members ORDER BY id" });
    await client.call("run_query", { query: "DELETE FROM members" });
    await client.call("connect", { url: "postgres://reader:hunter2@127.0.0.1:1/app", password: "s3cret" });
    entries = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  });

  after(async () => {
    await client.close();
  });

  test("one entry per call, in order", () => {
    assert.deepEqual(entries.map((entry) => entry.tool), ["run_query", "run_query", "connect"]);
  });

  test("a call records its input, the statement sent, and the full output", () => {
    const [read] = entries;
    assert.deepEqual(read.input, { query: "SELECT name FROM members ORDER BY id" });
    assert.equal(read.statements[0].engine, "SQLite");
    assert.equal(read.statements[0].text, "SELECT name FROM members ORDER BY id");
    assert.equal(read.statements[0].outcome, "2 rows");
    assert.match(read.output, /"name": "Ada"[\s\S]*"name": "Grace"/);
    assert.match(read.connection, /^default \(SQLite\) sqlite:/);
  });

  test("a refused query is logged as failed, with no statement sent", () => {
    const refused = entries[1];
    assert.equal(refused.failed, true);
    assert.deepEqual(refused.statements, []);
    assert.match(refused.output, /Only SELECT/);
  });

  test("credentials never reach the log", () => {
    const text = readFileSync(logPath, "utf8");
    assert.ok(!text.includes("hunter2"));
    assert.ok(!text.includes("s3cret"));
    assert.equal(entries[2].input.url, "postgres://reader:***@127.0.0.1:1/app");
  });

  test("the file is readable by its owner only", () => {
    assert.equal(statSync(logPath).mode & 0o777, 0o600);
  });

  test("the startup message says where the log is going", () => {
    assert.ok(client.stderr.includes(`call logging on`), client.stderr);
    assert.ok(client.stderr.includes(logPath), client.stderr);
  });
});

describe("DB_LOG=true, pretty, to stderr", () => {
  let client;

  before(async () => {
    client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "true" });
    await client.initialize();
  });

  after(async () => {
    await client.close();
  });

  test("the call appears on stderr as a pretty block, and the protocol still works", async () => {
    const { text, isError } = await client.call("list_tables");
    assert.equal(isError, false);
    assert.match(text, /members/);
    assert.match(client.stderr, /┌─ #1 list_tables · ok · \d+ ms/);
    assert.match(client.stderr, /│ statements \(1\)\n│   1\. SQLite/);
  });
});

describe("DB_LOG_PORT, the live viewer", () => {
  let client;
  let port;

  before(async () => {
    port = await freePort();
    client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "true", DB_LOG_PORT: String(port) });
    await client.initialize();
    await client.call("run_query", { query: "SELECT COUNT(*) AS total FROM members" });
  });

  after(async () => {
    await client.close();
  });

  test("serves the page", async () => {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Live call log/);
  });

  test("lists the call already made, newest first, via the entries API", async () => {
    const page = await (await fetch(`http://127.0.0.1:${port}/api/entries?size=10`)).json();
    const [latest] = page.entries;
    assert.equal(latest.data.tool, "run_query");
    assert.equal(latest.data.statements[0].text, "SELECT COUNT(*) AS total FROM members");
    assert.match(latest.data.output, /"total": 2/);
  });

  test("streams the next call live", async () => {
    const reading = readEvents(`http://127.0.0.1:${port}/events`, (seen) => seen.some((event) => event.event === "entry"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await client.call("list_tables");
    const entry = (await reading).find((event) => event.event === "entry");
    assert.equal(entry.data.data.tool, "list_tables");
  });

  test("announces the URL on stderr", () => {
    assert.match(client.stderr, new RegExp(`live log viewer at http://127\\.0\\.0\\.1:${port}/`));
  });

  test("the port is released when the server shuts down", async () => {
    const probe = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "true", DB_LOG_PORT: String(await freePort()) });
    await probe.initialize();
    await probe.call("list_tables");
    const match = /live log viewer at http:\/\/127\.0\.0\.1:(\d+)\//.exec(probe.stderr);
    await probe.close();
    await assert.rejects(() => fetch(`http://127.0.0.1:${match[1]}/`));
  });
});

describe("the viewer binds on the first call, not at startup", () => {
  test("an idle copy of the server holds no port", async () => {
    const port = await freePort();
    const client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "true", DB_LOG_PORT: String(port) });
    try {
      await client.initialize();
      await assert.rejects(() => fetch(`http://127.0.0.1:${port}/`));
      await client.call("list_tables");
      assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    } finally {
      await client.close();
    }
  });
});

describe("a busy viewer port", () => {
  let blocker;
  let port;
  let client;

  before(async () => {
    const { createServer } = await import("node:net");
    blocker = createServer();
    await new Promise((resolve) => blocker.listen(0, "0.0.0.0", resolve));
    port = blocker.address().port;
    client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "true", DB_LOG_PORT: String(port) });
    await client.initialize();
  });

  after(async () => {
    await client.close();
    blocker.close();
  });

  test("is explained once in the chat, and the call still succeeds", async () => {
    const first = await client.call("run_query", { query: "SELECT 1 AS one" });
    assert.equal(first.isError, false);
    assert.match(first.text, new RegExp(`Live log viewer unavailable: port ${port} (is used by|is already in use).*Free that port, or set DB_LOG_PORT`));

    const second = await client.call("run_query", { query: "SELECT 1 AS one" });
    assert.doesNotMatch(second.text, /Live log viewer/);
  });

  test("current_connection reports the viewer's state", async () => {
    const { text } = await client.call("current_connection");
    assert.match(text, /Live log viewer: unavailable/);
  });

  test("freeing the port brings the viewer up on the next call, announced once", async () => {
    await new Promise((resolve) => blocker.close(resolve));
    const next = await client.call("list_tables");
    assert.match(next.text, new RegExp(`Live log viewer is now running at http://127\\.0\\.0\\.1:${port}/`));
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
    assert.match((await client.call("current_connection")).text, /Live log viewer: running at/);
  });
});

describe("DB_LOG_DIR, the permanent log folder", () => {
  let folder;
  let first;
  let second;
  let port;

  before(async () => {
    folder = join(directory, "saved");
    port = await freePort();
    // Two copies of the server sharing one folder, as Claude Desktop runs them.
    first = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "", DB_LOG_FILE: "", DB_LOG_DIR: folder, DB_LOG_PORT: String(port) });
    second = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "", DB_LOG_FILE: "", DB_LOG_DIR: folder, DB_LOG_PORT: String(port) });
    await first.initialize();
    await second.initialize();
    await first.call("run_query", { query: "SELECT 'from the first copy' AS origin" });
    await second.call("run_query", { query: "SELECT 'from the second copy' AS origin" });
  });

  after(async () => {
    await first.close();
    await second.close();
  });

  test("each call is its own JSON file, in a folder per day", () => {
    const days = readdirSync(folder);
    assert.equal(days.length, 1);
    const files = readdirSync(join(folder, days[0]));
    const calls = files.filter((file) => /_c\d+_run_query_ok\.json$/.test(file));
    assert.equal(calls.length, 2, files.join(", "));
    const saved = JSON.parse(readFileSync(join(folder, days[0], calls[0]), "utf8"));
    assert.equal(saved.type, "call");
    assert.ok(saved.pid > 0);
  });

  test("writes no text log when DB_LOG_DIR is the only output", () => {
    assert.ok(!first.stderr.includes("┌─"));
  });

  test("the one viewer shows the calls of both copies", async () => {
    let origins = [];
    for (let attempt = 0; attempt < 30 && origins.length < 2; attempt += 1) {
      const page = await (await fetch(`http://127.0.0.1:${port}/api/entries?tool=run_query`)).json();
      origins = page.entries.map((entry) => entry.data.output);
      if (origins.length < 2) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.ok(origins.some((output) => output.includes("from the first copy")), origins.join("\n"));
    assert.ok(origins.some((output) => output.includes("from the second copy")), origins.join("\n"));
  });

  test("the copy without the port says so once, and its calls still land in the folder", () => {
    assert.match(second.stderr + first.stderr, /Live log viewer unavailable/);
  });

  test("a restarted server reads everything saved before", async () => {
    const later = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "", DB_LOG_FILE: "", DB_LOG_DIR: folder, DB_LOG_PORT: String(await freePort()) });
    try {
      await later.initialize();
      await later.call("list_tables");
      const match = /live log viewer at http:\/\/127\.0\.0\.1:(\d+)\//.exec(later.stderr);
      const page = await (await fetch(`http://127.0.0.1:${match[1]}/api/entries?size=50`)).json();
      assert.ok(page.total >= 3, `total ${page.total}`);
    } finally {
      await later.close();
    }
  });
});

describe("DB_LOG_PORT without logging", () => {
  test("starts no viewer and warns", async () => {
    const port = await freePort();
    const client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "", DB_LOG_FILE: "", DB_LOG_PORT: String(port) });
    try {
      await client.initialize();
      assert.match(client.stderr, /DB_LOG_PORT is set but call logging is off/);
      await assert.rejects(() => fetch(`http://127.0.0.1:${port}/`));
    } finally {
      await client.close();
    }
  });
});

describe("logging off, the default", () => {
  test("nothing but the startup lines reaches stderr", async () => {
    const client = new McpClient({ DB_URL: databaseUrl, DB_PROFILES: "", DB_LOG: "", DB_LOG_FILE: "" });
    try {
      await client.initialize();
      await client.call("run_query", { query: "SELECT 1 AS one" });
      assert.ok(!client.stderr.includes("┌─"), client.stderr);
      assert.ok(!client.stderr.includes("call logging on"), client.stderr);
    } finally {
      await client.close();
    }
  });
});
