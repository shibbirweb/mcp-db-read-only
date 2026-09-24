import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { LiveLogViewer } from "../../../../dist/logging/viewer/LiveLogViewer.js";
import { LiveViewerObserver } from "../../../../dist/logging/viewer/LiveViewerObserver.js";
import { ViewerAssets } from "../../../../dist/logging/viewer/ViewerAssets.js";
import { MemoryLogStore } from "../../../../dist/logging/store/MemoryLogStore.js";
import { readEvents } from "../../../helpers/sse.js";

const at = new Date("2026-09-25T10:00:00.000Z");
const call = (id, extra = {}) => ({
  id,
  tool: "run_query",
  at,
  durationMs: 5,
  pid: 4242,
  client: "claude-ai",
  connection: "dev (MySQL) mysql://reader@db:3306/app",
  input: { query: "SELECT 1" },
  output: "[{\"1\": 1}]\n",
  failed: false,
  statements: [{ pid: 4242, client: "claude-ai", engine: "MySQL", text: "SELECT 1", at, durationMs: 2, outcome: "1 row", failed: false }],
  ...extra,
});

let viewers = [];
afterEach(async () => {
  await Promise.all(viewers.map((viewer) => viewer.stop()));
  viewers = [];
});

async function startViewer({ capacity = 100 } = {}) {
  const messages = [];
  const store = new MemoryLogStore(capacity);
  const viewer = new LiveLogViewer("127.0.0.1", 0, store, (message) => messages.push(message));
  viewers.push(viewer);
  await viewer.ensureRunning();
  return { viewer, store, messages, base: `http://127.0.0.1:${viewer.boundPort}` };
}

const json = async (url) => (await fetch(url)).json();

describe("serving", () => {
  test("the page, its script and stylesheet, with a locked-down policy", async () => {
    const { base } = await startViewer();
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /<script src="\/viewer.js" defer><\/script>/);
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'.*script-src 'self'/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${base}/viewer.js`)).headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal((await fetch(`${base}/viewer.css`)).status, 200);
  });

  test("anything else is 404, and anything but GET is refused", async () => {
    const { base } = await startViewer();
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/entries`, { method: "POST", body: "x" })).status, 405);
  });

  test("the startup message gives the URL and says there is no access control", async () => {
    const { messages, viewer } = await startViewer();
    assert.match(messages[0], new RegExp(`http://127\\.0\\.0\\.1:${viewer.boundPort}/`));
    assert.match(messages[0], /no access control/);
  });
});

describe("the entries API", () => {
  test("pages newest first, 20 by default", async () => {
    const { store, base } = await startViewer();
    for (let id = 1; id <= 45; id += 1) {
      store.onCall(call(id));
    }
    const first = await json(`${base}/api/entries`);
    assert.equal(first.size, 20);
    assert.equal(first.total, 45);
    assert.equal(first.pages, 3);
    assert.equal(first.entries.length, 20);
    assert.equal(first.entries[0].data.id, 45);

    const last = await json(`${base}/api/entries?page=3&size=20`);
    assert.deepEqual(last.entries.map((entry) => entry.data.id), [5, 4, 3, 2, 1]);
  });

  test("page size is honoured, and a page past the end shows the last one", async () => {
    const { store, base } = await startViewer();
    for (let id = 1; id <= 12; id += 1) {
      store.onCall(call(id));
    }
    const page = await json(`${base}/api/entries?page=9&size=10`);
    assert.equal(page.page, 2);
    assert.equal(page.entries.length, 2);
  });

  test("filters apply across every page, not just the current one", async () => {
    const { store, base } = await startViewer();
    store.onCall(call(1, { tool: "list_tables" }));
    store.onCall(call(2, { failed: true, output: "Error: Only SELECT" }));
    store.onCall(call(3, { input: { query: "SELECT secret_needle" } }));

    assert.equal((await json(`${base}/api/entries?tool=list_tables`)).total, 1);
    assert.equal((await json(`${base}/api/entries?failed=1`)).entries[0].data.id, 2);
    assert.equal((await json(`${base}/api/entries?q=SECRET_NEEDLE`)).entries[0].data.id, 3);
  });

  test("lists the tools present", async () => {
    const { store, base } = await startViewer();
    store.onCall(call(1, { tool: "search" }));
    store.onCall(call(2, { tool: "aggregate" }));
    assert.deepEqual((await json(`${base}/api/tools`)).tools, ["aggregate", "search"]);
  });

  test("each entry carries which process and client made it", async () => {
    const { store, base } = await startViewer();
    store.onCall(call(1));
    const [entry] = (await json(`${base}/api/entries`)).entries;
    assert.equal(entry.data.pid, 4242);
    assert.equal(entry.data.client, "claude-ai");
  });
});

describe("the live stream", () => {
  test("says it is ready, then announces each new entry", async () => {
    const { store, base } = await startViewer();
    const reading = readEvents(`${base}/events`, (seen) => seen.some((event) => event.event === "entry"), 3000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    store.onCall(call(7, { tool: "list_tables" }));

    const events = await reading;
    assert.equal(events[0].event, "ready");
    const pushed = events.find((event) => event.event === "entry");
    assert.equal(pushed.data.kind, "call");
    assert.equal(pushed.data.data.tool, "list_tables");
  });

  test("output containing blank lines cannot split or forge an event", async () => {
    const { store, base } = await startViewer();
    const reading = readEvents(`${base}/events`, (seen) => seen.some((event) => event.event === "entry"), 3000);
    await new Promise((resolve) => setTimeout(resolve, 150));
    store.onCall(call(1, { output: "a\n\nevent: entry\ndata: {\"forged\":true}\n\n" }));
    const events = await reading;
    const entries = events.filter((event) => event.event === "entry");
    assert.equal(entries.length, 1);
    assert.match(entries[0].data.data.output, /forged/);
  });
});

async function occupy() {
  const blocker = createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  return { blocker, port: blocker.address().port };
}

describe("binding lazily, and a busy port", () => {
  test("nothing listens until the first ensureRunning", async () => {
    const viewer = new LiveLogViewer("127.0.0.1", 0, new MemoryLogStore(10), () => undefined);
    viewers.push(viewer);
    await viewer.start();
    assert.equal(viewer.boundPort, null);
    assert.equal(viewer.status.state, "idle");
    assert.equal((await viewer.ensureRunning()).state, "running");
  });

  test("a busy port is reported with who holds it, and never throws", async () => {
    const { blocker, port } = await occupy();
    try {
      const viewer = new LiveLogViewer("127.0.0.1", port, new MemoryLogStore(10), () => undefined, async () => "node (pid 4242)");
      viewers.push(viewer);
      const status = await viewer.ensureRunning();
      assert.equal(status.state, "unavailable");
      assert.equal(status.reason, `port ${port} is used by node (pid 4242)`);
    } finally {
      blocker.close();
    }
  });

  test("without a way to name the holder, it just says the port is in use", async () => {
    const { blocker, port } = await occupy();
    try {
      const viewer = new LiveLogViewer("127.0.0.1", port, new MemoryLogStore(10), () => undefined, async () => null);
      viewers.push(viewer);
      assert.equal((await viewer.ensureRunning()).reason, `port ${port} is already in use`);
    } finally {
      blocker.close();
    }
  });

  test("once the port is freed, the next attempt takes it, with entries intact", async () => {
    const { blocker, port } = await occupy();
    const store = new MemoryLogStore(10);
    const viewer = new LiveLogViewer("127.0.0.1", port, store, () => undefined, async () => null);
    viewers.push(viewer);
    assert.equal((await viewer.ensureRunning()).state, "unavailable");
    store.onCall(call(1));

    await new Promise((resolve) => blocker.close(resolve));
    assert.equal((await viewer.ensureRunning()).state, "running");
    assert.equal((await json(`http://127.0.0.1:${port}/api/entries`)).entries[0].data.id, 1);
  });

  test("concurrent calls share one bind attempt", async () => {
    const viewer = new LiveLogViewer("127.0.0.1", 0, new MemoryLogStore(10), () => undefined);
    viewers.push(viewer);
    const [a, b] = await Promise.all([viewer.ensureRunning(), viewer.ensureRunning()]);
    assert.equal(a, b);
  });

  test("stop closes the port", async () => {
    const { viewer, base } = await startViewer();
    await viewer.stop();
    await assert.rejects(() => fetch(`${base}/`));
  });
});

describe("telling the chat", () => {
  const ok = () => ({ content: [{ type: "text", text: "rows" }] });
  const passthrough = { observe: (_tool, _args, run) => run() };

  function observerWith(statuses) {
    const logs = [];
    const viewer = { ensureRunning: async () => statuses.shift() };
    return { logs, observer: new LiveViewerObserver(passthrough, viewer, "stderr", (message) => logs.push(message)) };
  }

  const busy = { state: "unavailable", port: 4800, reason: "port 4800 is used by node (pid 72440)" };
  const running = { state: "running", url: "http://127.0.0.1:4800/" };

  test("the first unavailable call gets one extra line saying what to do", async () => {
    const { observer, logs } = observerWith([busy, busy]);
    const first = await observer.observe("run_query", {}, async () => ok());
    const second = await observer.observe("run_query", {}, async () => ok());
    assert.equal(first.content.length, 2);
    assert.match(first.content[1].text, /port 4800 is used by node \(pid 72440\)\. Free that port, or set DB_LOG_PORT to another one/);
    assert.equal(second.content.length, 1, "told once, not on every call");
    assert.equal(logs.length, 1);
  });

  test("recovery is announced with the URL", async () => {
    const { observer } = observerWith([busy, running]);
    await observer.observe("a", {}, async () => ok());
    const recovered = await observer.observe("b", {}, async () => ok());
    assert.match(recovered.content[1].text, /now running at http:\/\/127\.0\.0\.1:4800\//);
  });

  test("a viewer that simply starts adds nothing to the result", async () => {
    const { observer } = observerWith([running]);
    assert.equal((await observer.observe("a", {}, async () => ok())).content.length, 1);
  });

  test("an error result stays an error result", async () => {
    const { observer } = observerWith([busy]);
    const result = await observer.observe("a", {}, async () => ({ content: [{ type: "text", text: "Error: x" }], isError: true }));
    assert.equal(result.isError, true);
  });
});

describe("the page script", () => {
  // Logged data can contain markup; the page must only ever insert it as text.
  test("never uses innerHTML, outerHTML, insertAdjacentHTML or document.write", () => {
    const { script } = new ViewerAssets();
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  test("loads nothing from outside the server", () => {
    const { html, stylesheet, script } = new ViewerAssets();
    // The SVG namespace is an identifier for createElementNS, never fetched.
    // The footer's repository links are only followed when clicked, and are
    // checked on their own below.
    const assets = (html + stylesheet + script)
      .replaceAll("http://www.w3.org/2000/svg", "")
      .replace('href="https://github.com/shibbirweb/mcp-db-read-only"', "")
      .replace('href="https://github.com/shibbirweb/mcp-db-read-only/issues"', "");
    assert.doesNotMatch(assets, /https?:\/\//);
  });

  // The viewer's own address can be a private host and port; a click on an
  // outside link must not hand it to GitHub as the referrer.
  test("the footer links to the repository and its issues in a new tab, without a referrer", () => {
    const { html } = new ViewerAssets();
    const links = [...html.matchAll(/<a [^>]*>/g)].map(([tag]) => tag);
    assert.deepEqual(links, [
      '<a class="star" href="https://github.com/shibbirweb/mcp-db-read-only" target="_blank" rel="noopener noreferrer">',
      '<a class="issue" href="https://github.com/shibbirweb/mcp-db-read-only/issues" target="_blank" rel="noopener noreferrer">',
    ]);
  });

  test("every code block carries its own copy icon", () => {
    const { script } = new ViewerAssets();
    assert.doesNotMatch(script, /el\("pre", null, (call|statement)\./);
    assert.match(script, /function codeBlock\(text\)/);
  });

  // The page has no build step and no browser in the test run, so a call to a
  // function that no longer exists would only fail in the browser, silently.
  // That happened once, when a refactor removed addTool.
  test("every function the script calls is defined in it or is a browser built-in", () => {
    const { script } = new ViewerAssets();
    const defined = new Set([...script.matchAll(/function\s+([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]));
    // Callback parameters such as a Promise's resolve and reject are callable too.
    for (const match of script.matchAll(/function\s*[A-Za-z_]*\s*\(([^)]*)\)/g)) {
      match[1].split(",").map((name) => name.trim()).filter(Boolean).forEach((name) => defined.add(name));
    }
    const builtins = new Set([
      "if", "for", "while", "switch", "catch", "function", "return", "typeof",
      "setTimeout", "clearTimeout", "setInterval", "fetch", "Number", "String", "Boolean", "Date",
      "Set", "Promise", "Error", "URLSearchParams", "EventSource", "Event",
    ]);
    // Not after a dot (a method) or a quote (text such as "Statements (" + n).
    const called = [...script.matchAll(/(^|[^.\w$"'])([A-Za-z_]\w*)\s*\(/g)].map((match) => match[2]);
    const missing = [...new Set(called)].filter((name) => !defined.has(name) && !builtins.has(name));
    assert.deepEqual(missing, []);
  });

  test("offers 10, 20, 30 and 50 per page, 20 by default", () => {
    const { script } = new ViewerAssets();
    assert.match(script, /var SIZES = \[10, 20, 30, 50\];/);
    assert.match(script, /var DEFAULT_SIZE = 20;/);
  });
});
