import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FolderLogChannel } from "../../../../dist/logging/store/FolderLogChannel.js";
import { FolderLogStore } from "../../../../dist/logging/store/FolderLogStore.js";
import { LogFileNames } from "../../../../dist/logging/store/LogFileNames.js";
import { MemoryLogStore } from "../../../../dist/logging/store/MemoryLogStore.js";
import { Paging } from "../../../../dist/logging/store/LogStore.js";

const call = (id, at, extra = {}) => ({
  id,
  tool: "run_query",
  at,
  durationMs: 3,
  pid: 1000,
  client: "claude-ai",
  connection: "dev (MySQL) mysql://reader@db:3306/app",
  input: { query: `SELECT ${id}` },
  output: `[${id}]`,
  failed: false,
  statements: [],
  ...extra,
});

let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mcp-db-ro-store-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("file names", () => {
  test("carry day, time, pid, sequence, tool and outcome", () => {
    const name = LogFileNames.build(new Date("2026-09-25T10:30:14.221Z"), 72440, "call", 12, "run_query", false);
    assert.equal(name, "2026-09-25/103014-221Z_p72440_c000012_run_query_ok.json");
  });

  test("parse back to the same facts", () => {
    const info = LogFileNames.parse("2026-09-25", "103014-221Z_p72440_c000012_run_query_failed.json");
    assert.equal(info.at.toISOString(), "2026-09-25T10:30:14.221Z");
    assert.equal(info.pid, 72440);
    assert.equal(info.tool, "run_query");
    assert.equal(info.failed, true);
    assert.equal(info.kind, "call");
  });

  test("temporaries and foreign files are not ours", () => {
    assert.equal(LogFileNames.parse("2026-09-25", "103014-221Z_p1_c000001_run_query_ok.json.1.tmp"), null);
    assert.equal(LogFileNames.parse("2026-09-25", "notes.txt"), null);
    assert.equal(LogFileNames.parse("misc", "103014-221Z_p1_c000001_run_query_ok.json"), null);
  });
});

describe("saving", () => {
  test("one pretty JSON file per call, in a folder per day, owner-only", () => {
    const channel = new FolderLogChannel(directory);
    channel.onCall(call(1, new Date("2026-09-25T10:00:00.000Z")));
    channel.onCall(call(2, new Date("2026-09-26T09:00:00.000Z"), { failed: true, tool: "aggregate" }));

    assert.deepEqual(readdirSync(directory).sort(), ["2026-09-25", "2026-09-26"]);
    const [file] = readdirSync(join(directory, "2026-09-26"));
    assert.match(file, /^090000-000Z_p1000_c000002_aggregate_failed\.json$/);
    const saved = JSON.parse(readFileSync(join(directory, "2026-09-26", file), "utf8"));
    assert.equal(saved.type, "call");
    assert.equal(saved.tool, "aggregate");
    assert.equal(statSync(join(directory, "2026-09-26", file)).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, "2026-09-26")).mode & 0o777, 0o700);
  });

  test("leaves no temporary files behind", () => {
    new FolderLogChannel(directory).onCall(call(1, new Date("2026-09-25T10:00:00.000Z")));
    assert.ok(readdirSync(join(directory, "2026-09-25")).every((file) => file.endsWith(".json")));
  });

  test("statements outside a call get files of their own", () => {
    new FolderLogChannel(directory).onStatement({
      pid: 1000, client: null, engine: "MySQL", text: "SET SESSION TRANSACTION READ ONLY",
      at: new Date("2026-09-25T10:00:00.000Z"), durationMs: 1, outcome: "ok", failed: false,
    });
    assert.match(readdirSync(join(directory, "2026-09-25"))[0], /_s000001_statement_ok\.json$/);
  });
});

describe("reading the folder back", () => {
  function fill(count, pid = 1000) {
    const channel = new FolderLogChannel(directory);
    for (let id = 1; id <= count; id += 1) {
      channel.onCall(call(id, new Date(Date.UTC(2026, 8, 25, 10, 0, id)), { pid, tool: id % 2 ? "run_query" : "list_tables", failed: id % 5 === 0 }));
    }
  }

  test("pages newest first, across day folders", async () => {
    fill(25);
    const store = new FolderLogStore(directory);
    const page = await store.query({ page: 1, size: 10 });
    assert.equal(page.total, 25);
    assert.equal(page.pages, 3);
    assert.deepEqual(page.entries.map((entry) => entry.data.id), [25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    assert.deepEqual((await store.query({ page: 3, size: 10 })).entries.map((entry) => entry.data.id), [5, 4, 3, 2, 1]);
  });

  test("tool and failed filters come from the names alone", async () => {
    fill(20);
    const store = new FolderLogStore(directory);
    assert.equal((await store.query({ page: 1, size: 50, tool: "list_tables" })).total, 10);
    assert.deepEqual((await store.query({ page: 1, size: 50, failedOnly: true })).entries.map((entry) => entry.data.id), [20, 15, 10, 5]);
  });

  test("text search reads the files, across every page", async () => {
    fill(30);
    const store = new FolderLogStore(directory);
    const found = await store.query({ page: 1, size: 10, text: "select 7" });
    assert.deepEqual(found.entries.map((entry) => entry.data.id), [7]);
  });

  test("sees entries written by other processes into the same folder", async () => {
    fill(3, 1000);
    fill(2, 2000);
    const store = new FolderLogStore(directory);
    const pids = (await store.query({ page: 1, size: 50 })).entries.map((entry) => entry.data.pid);
    assert.deepEqual(pids.sort(), [1000, 1000, 1000, 2000, 2000]);
  });

  test("survives a restart: a new store reads what an old process saved", async () => {
    fill(4);
    assert.equal((await new FolderLogStore(directory).query({ page: 1, size: 20 })).total, 4);
  });

  test("a file deleted by hand simply drops out", async () => {
    fill(3);
    const store = new FolderLogStore(directory);
    await store.query({ page: 1, size: 20 });
    const day = join(directory, "2026-09-25");
    unlinkSync(join(day, readdirSync(day)[0]));
    await store.query({ page: 1, size: 20, text: "select" });
    assert.equal((await store.query({ page: 1, size: 20 })).total, 2);
  });

  test("unrelated files in the folder are ignored", async () => {
    mkdirSync(join(directory, "2026-09-25"), { recursive: true });
    writeFileSync(join(directory, "README.txt"), "notes");
    writeFileSync(join(directory, "2026-09-25", "draft.json"), "{}");
    fill(1);
    assert.equal((await new FolderLogStore(directory).query({ page: 1, size: 20 })).total, 1);
  });

  test("lists the tools present", async () => {
    fill(4);
    assert.deepEqual(await new FolderLogStore(directory).tools(), ["list_tables", "run_query"]);
  });
});

describe("new entries", () => {
  test("this process's own writes are announced at once", async () => {
    const store = new FolderLogStore(directory);
    const seen = [];
    store.subscribe((entry) => seen.push(entry.data.id));
    const channel = new FolderLogChannel(directory, (entry) => store.noteWritten(entry));
    channel.onCall(call(1, new Date()));
    assert.deepEqual(seen, [1]);
    assert.equal((await store.query({ page: 1, size: 20 })).total, 1);
  });

  test("another process's writes are found by the scan, and announced once", async () => {
    const store = new FolderLogStore(directory);
    const seen = [];
    store.subscribe((entry) => seen.push(entry.data.id));
    store.start();
    try {
      new FolderLogChannel(directory).onCall(call(9, new Date(), { pid: 2000 }));
      for (let attempt = 0; attempt < 30 && seen.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.deepEqual(seen, [9]);
    } finally {
      store.stop();
    }
  });

  test("a write before the first query still leaves the whole folder indexed", async () => {
    const earlier = new FolderLogChannel(directory);
    earlier.onCall(call(1, new Date("2026-09-20T10:00:00.000Z")));
    const store = new FolderLogStore(directory);
    new FolderLogChannel(directory, (entry) => store.noteWritten(entry)).onCall(call(2, new Date()));
    assert.equal((await store.query({ page: 1, size: 20 })).total, 2);
  });
});

describe("the memory store and paging", () => {
  test("drops the oldest past its capacity", async () => {
    const store = new MemoryLogStore(3);
    for (let id = 1; id <= 5; id += 1) {
      store.onCall(call(id, new Date()));
    }
    assert.deepEqual((await store.query({ page: 1, size: 10 })).entries.map((entry) => entry.data.id), [5, 4, 3]);
  });

  test("paging clamps sizes and pages to sensible values", () => {
    assert.deepEqual(Paging.normalise({ page: 0, size: 0 }), { page: 1, size: 20 });
    assert.deepEqual(Paging.normalise({ page: 2, size: 500 }), { page: 2, size: 100 });
    assert.equal(Paging.page([], { page: 5, size: 10 }).pages, 1);
  });
});
