/**
 * The live viewer's page, stylesheet and script.
 *
 * Kept as strings in a module rather than as files beside it, so `tsc` alone
 * ships them in `dist/` and the npm tarball, the Docker image and a local
 * build all carry them without a copy step that could be forgotten.
 *
 * Self-contained on purpose: no framework, no CDN, no web font. The page runs
 * on data that may be private, so it fetches nothing from anywhere but this
 * server, and the server's Content-Security-Policy enforces that.
 *
 * Every piece of logged data is placed with `textContent`, never `innerHTML`.
 * A row read from a database can contain `<script>`; here it is only ever
 * text. A test asserts the script never uses `innerHTML`.
 *
 * The strings avoid backticks and `${`, since they sit inside template
 * literals.
 */
export class ViewerAssets {
  public readonly html = HTML;
  public readonly stylesheet = STYLESHEET;
  public readonly script = SCRIPT;
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Live call log</title>
<link rel="stylesheet" href="/viewer.css">
<script src="/viewer.js" defer></script>
</head>
<body>
<header>
  <div class="bar">
    <div class="title">
      <span class="dot" id="dot"></span>
      <h1>Live call log</h1>
      <span class="status" id="status">Connecting</span>
    </div>
    <div class="stats" id="stats"></div>
  </div>
  <div class="controls">
    <input id="filter" type="search" placeholder="Filter by any text" autocomplete="off">
    <select id="tool"><option value="">All tools</option></select>
    <label class="check"><input id="failed" type="checkbox"> Failed only</label>
    <button id="pause" type="button">Pause</button>
    <button id="expand" type="button">Expand all</button>
  </div>
</header>
<main>
  <button class="banner" id="banner" type="button" hidden></button>
  <nav class="pager" id="pager-top"></nav>
  <p class="empty" id="empty" hidden>No calls yet. Each call appears here the moment it finishes.</p>
  <div id="entries"></div>
  <nav class="pager" id="pager-bottom"></nav>
</main>
</body>
</html>
`;

const STYLESHEET = `:root {
  color-scheme: light dark;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --text: #1c2330;
  --muted: #667085;
  --border: #e3e6eb;
  --code: #f1f3f6;
  --accent: #2f6fed;
  --ok: #16803c;
  --ok-bg: #e5f5eb;
  --bad: #c0362c;
  --bad-bg: #fdecea;
  --warn: #9a6700;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1216;
    --panel: #171b21;
    --text: #e6e9ee;
    --muted: #8b95a5;
    --border: #262c35;
    --code: #11151a;
    --accent: #6e9bff;
    --ok: #4cc27a;
    --ok-bg: #11291b;
    --bad: #ff7b72;
    --bad-bg: #2d1515;
    --warn: #e3b341;
  }
}
* { box-sizing: border-box; }
/* Author styles such as .banner's display: block would otherwise override the hidden attribute. */
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  padding: 12px 20px;
}
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.title { display: flex; align-items: center; gap: 10px; }
h1 { font-size: 16px; margin: 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--warn); }
.dot.live { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-bg); }
.dot.down { background: var(--bad); }
.status, .stats { color: var(--muted); font-size: 13px; }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }
input[type=search], select, button {
  font: inherit;
  color: inherit;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
}
input[type=search] { flex: 1 1 240px; min-width: 0; }
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.check { display: flex; align-items: center; gap: 6px; color: var(--muted); }
main { padding: 16px 20px 40px; max-width: 1200px; margin: 0 auto; }
.empty { color: var(--muted); text-align: center; margin-top: 60px; }
.entry {
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--ok);
  border-radius: 8px;
  margin-bottom: 8px;
}
.entry.failed { border-left-color: var(--bad); }
.entry.statement { border-left-color: var(--muted); }
.entry.fresh { animation: flash 1.2s ease-out; }
@keyframes flash { from { box-shadow: 0 0 0 3px var(--accent); } to { box-shadow: 0 0 0 0 transparent; } }
summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 9px 14px;
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker { display: none; }
summary::before { content: "\\25B8"; color: var(--muted); width: 10px; }
details[open] > summary::before { content: "\\25BE"; }
.id { color: var(--muted); font-variant-numeric: tabular-nums; }
.tool { font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.badge { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: var(--ok-bg); color: var(--ok); }
.badge.failed { background: var(--bad-bg); color: var(--bad); }
.meta { color: var(--muted); font-size: 13px; }
.conn { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 520px; }
time { margin-left: auto; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.body { padding: 0 14px 14px; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 14px 0 6px; }
pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--code);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: auto;
  max-height: 480px;
  font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.code { position: relative; }
.code pre { padding-right: 40px; }
.copy-icon {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  opacity: .55;
  transition: opacity .15s, color .15s, border-color .15s;
}
.code:hover .copy-icon, .copy-icon:focus-visible { opacity: 1; }
.copy-icon:hover { color: var(--accent); border-color: var(--accent); }
.copy-icon.done { opacity: 1; color: var(--ok); border-color: var(--ok); }
.copy-icon.error { opacity: 1; color: var(--bad); border-color: var(--bad); }
.copy-icon svg { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.label { font-size: 12px; color: var(--muted); margin: 6px 0 2px; }
.pager { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 12px; color: var(--muted); font-size: 13px; }
.pager .spacer { flex: 1; }
.pager button[disabled] { opacity: .4; cursor: default; }
.pager button.current { background: var(--accent); border-color: var(--accent); color: #fff; }
.pager select { padding: 3px 8px; }
.banner {
  display: block;
  width: 100%;
  margin-bottom: 12px;
  padding: 8px;
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
  border-radius: 8px;
  font-weight: 600;
}
.origin { color: var(--muted); font-size: 12px; }
ol.statements { margin: 0; padding-left: 22px; }
ol.statements li { margin-bottom: 8px; }
.stmt-head { font-size: 13px; color: var(--muted); margin-bottom: 4px; }
.stmt-head .failed { color: var(--bad); }
.actions { margin-top: 12px; }
`;

const SCRIPT = `(function () {
  "use strict";

  var list = document.getElementById("entries");
  var empty = document.getElementById("empty");
  var dot = document.getElementById("dot");
  var statusText = document.getElementById("status");
  var stats = document.getElementById("stats");
  var filterInput = document.getElementById("filter");
  var toolSelect = document.getElementById("tool");
  var failedOnly = document.getElementById("failed");
  var pauseButton = document.getElementById("pause");
  var expandButton = document.getElementById("expand");

  var tools = new Set();
  var paused = false;
  var expanded = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function pretty(value) {
    if (value === undefined) { return ""; }
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
  }

  function clock(iso) {
    var date = new Date(iso);
    function pad(n, size) { return String(n).padStart(size, "0"); }
    return pad(date.getHours(), 2) + ":" + pad(date.getMinutes(), 2) + ":" + pad(date.getSeconds(), 2) + "." + pad(date.getMilliseconds(), 3);
  }

  // Which copy of the server made the entry: several share one log folder.
  function origin(record) {
    return (record.client || "unknown client") + " \\u00b7 pid " + record.pid;
  }

  function section(title, content) {
    var wrap = el("section");
    wrap.appendChild(el("h3", null, title));
    wrap.appendChild(content);
    return wrap;
  }

  function statementItem(statement) {
    var item = el("li");
    var head = el("div", "stmt-head");
    head.appendChild(el("span", null, statement.engine + " \\u00b7 " + statement.durationMs + " ms \\u00b7 "));
    head.appendChild(el("span", statement.failed ? "failed" : null, statement.failed ? "FAILED: " + statement.outcome : statement.outcome));
    item.appendChild(head);
    item.appendChild(codeBlock(statement.text));
    if (statement.params !== undefined && statement.params !== null) {
      item.appendChild(el("div", "label", "params"));
      item.appendChild(codeBlock(pretty(statement.params)));
    }
    return item;
  }

  // The clipboard API only exists on a secure origin. 127.0.0.1 is one, but
  // the page opened from another device by its LAN address is not, so the
  // old selection-based copy is the fallback there.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var copied = false;
      try { copied = document.execCommand("copy"); } catch (error) { copied = false; }
      area.remove();
      if (copied) { resolve(); } else { reject(new Error("copy failed")); }
    });
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  function icon(kind) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    function shape(tag, attributes) {
      var node = document.createElementNS(SVG_NS, tag);
      Object.keys(attributes).forEach(function (name) { node.setAttribute(name, attributes[name]); });
      svg.appendChild(node);
    }
    if (kind === "check") {
      shape("polyline", { points: "3,8.5 6.5,12 13,4.5" });
    } else {
      shape("rect", { x: "5.5", y: "5.5", width: "8", height: "8", rx: "1.5" });
      shape("path", { d: "M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9A1.5 1.5 0 0 0 3.5 10.5H5.5" });
    }
    return svg;
  }

  function flash(button, ok, idle) {
    button.replaceChildren(ok ? icon("check") : icon("copy"));
    button.classList.toggle("done", ok);
    button.classList.toggle("error", !ok);
    button.title = ok ? "Copied" : "Copy failed";
    setTimeout(function () {
      button.replaceChildren(icon("copy"));
      button.classList.remove("done", "error");
      button.title = idle;
    }, 1400);
  }

  function copyIcon(read, label) {
    var button = el("button", "copy-icon");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(icon("copy"));
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      copyText(read()).then(function () { flash(button, true, label); }, function () { flash(button, false, label); });
    });
    return button;
  }

  // A code block with a copy icon in its corner, copying exactly the text shown.
  function codeBlock(text) {
    var wrap = el("div", "code");
    var pre = el("pre", null, text);
    wrap.appendChild(pre);
    wrap.appendChild(copyIcon(function () { return pre.textContent; }, "Copy"));
    return wrap;
  }

  function copyButton(payload) {
    var button = el("button", null, "Copy entry as JSON");
    button.type = "button";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      copyText(JSON.stringify(payload, null, 2)).then(function () {
        button.textContent = "Copied";
        setTimeout(function () { button.textContent = "Copy entry as JSON"; }, 1500);
      }, function () {
        button.textContent = "Copy failed";
        setTimeout(function () { button.textContent = "Copy entry as JSON"; }, 1500);
      });
    });
    var wrap = el("div", "actions");
    wrap.appendChild(button);
    return wrap;
  }

  function renderCall(call) {
    var card = el("details", "entry call" + (call.failed ? " failed" : ""));
    var summary = el("summary");
    summary.appendChild(el("span", "id", "#" + call.id));
    summary.appendChild(el("span", "tool", call.tool));
    summary.appendChild(el("span", "badge" + (call.failed ? " failed" : ""), call.failed ? "failed" : "ok"));
    summary.appendChild(el("span", "meta", call.durationMs + " ms"));
    if (call.statements.length > 0) {
      summary.appendChild(el("span", "meta", call.statements.length + " statement" + (call.statements.length === 1 ? "" : "s")));
    }
    summary.appendChild(el("span", "conn", call.connection || "no connection"));
    summary.appendChild(el("span", "origin", origin(call)));
    summary.appendChild(el("time", null, clock(call.at)));
    card.appendChild(summary);

    var body = el("div", "body");
    body.appendChild(section("Connection", codeBlock(call.connection || "none")));
    body.appendChild(section("Input", codeBlock(pretty(call.input))));
    if (call.statements.length > 0) {
      var ordered = el("ol", "statements");
      call.statements.forEach(function (statement) { ordered.appendChild(statementItem(statement)); });
      body.appendChild(section("Statements (" + call.statements.length + ")", ordered));
    }
    body.appendChild(section(call.failed ? "Error" : "Output", codeBlock(call.output)));
    body.appendChild(copyButton(call));
    card.appendChild(body);
    return card;
  }

  function renderStatement(statement) {
    var card = el("details", "entry statement" + (statement.failed ? " failed" : ""));
    var summary = el("summary");
    summary.appendChild(el("span", "tool", statement.engine));
    summary.appendChild(el("span", "badge" + (statement.failed ? " failed" : ""), statement.failed ? "failed" : statement.outcome));
    summary.appendChild(el("span", "meta", statement.durationMs + " ms \\u00b7 outside a tool call"));
    summary.appendChild(el("span", "origin", origin(statement)));
    summary.appendChild(el("time", null, clock(statement.at)));
    card.appendChild(summary);
    var body = el("div", "body");
    var ordered = el("ol", "statements");
    ordered.appendChild(statementItem(statement));
    body.appendChild(ordered);
    body.appendChild(copyButton(statement));
    card.appendChild(body);
    return card;
  }

  // Keeps the tool filter in step with the tools seen, in alphabetical order.
  function addTool(name) {
    if (!name || tools.has(name)) { return; }
    tools.add(name);
    var option = el("option", null, name);
    option.value = name;
    var options = Array.prototype.slice.call(toolSelect.options, 1);
    var before = options.find(function (existing) { return existing.value > name; });
    toolSelect.insertBefore(option, before || null);
  }

  var SIZES = [10, 20, 30, 50];
  var DEFAULT_SIZE = 20;
  var SIZE_KEY = "mcp-db-read-only.pageSize";
  var pagerTop = document.getElementById("pager-top");
  var pagerBottom = document.getElementById("pager-bottom");
  var banner = document.getElementById("banner");

  // Remembered per browser; storage can be unavailable, so every access is guarded.
  function savedSize() {
    try {
      var stored = Number(window.localStorage.getItem(SIZE_KEY));
      return SIZES.indexOf(stored) === -1 ? DEFAULT_SIZE : stored;
    } catch (error) { return DEFAULT_SIZE; }
  }
  function saveSize(size) {
    try { window.localStorage.setItem(SIZE_KEY, String(size)); } catch (error) { return; }
  }

  var state = { page: 1, size: savedSize(), total: 0, pages: 1, loading: false, pendingNew: 0 };
  var openKeys = new Set();
  var reloadTimer = null;

  function query() {
    var params = new URLSearchParams();
    params.set("page", String(state.page));
    params.set("size", String(state.size));
    if (toolSelect.value) { params.set("tool", toolSelect.value); }
    if (failedOnly.checked) { params.set("failed", "1"); }
    if (filterInput.value.trim()) { params.set("q", filterInput.value.trim()); }
    return params.toString();
  }

  function pagerButton(label, page, disabled, current) {
    var button = el("button", current ? "current" : null, label);
    button.type = "button";
    button.disabled = Boolean(disabled);
    button.addEventListener("click", function () { goTo(page); });
    return button;
  }

  // First, previous, a window of page numbers, next, last.
  function renderPager(nav) {
    nav.replaceChildren();
    var from = state.total === 0 ? 0 : (state.page - 1) * state.size + 1;
    var to = Math.min(state.page * state.size, state.total);
    nav.appendChild(el("span", null, "Showing " + from + "\u2013" + to + " of " + state.total));
    nav.appendChild(el("span", "spacer"));

    nav.appendChild(pagerButton("\u00ab", 1, state.page <= 1));
    nav.appendChild(pagerButton("\u2039 Prev", state.page - 1, state.page <= 1));
    var first = Math.max(1, state.page - 2);
    var last = Math.min(state.pages, first + 4);
    first = Math.max(1, last - 4);
    for (var page = first; page <= last; page += 1) {
      nav.appendChild(pagerButton(String(page), page, false, page === state.page));
    }
    nav.appendChild(pagerButton("Next \u203a", state.page + 1, state.page >= state.pages));
    nav.appendChild(pagerButton("\u00bb", state.pages, state.page >= state.pages));

    var select = el("select");
    SIZES.forEach(function (size) {
      var option = el("option", null, size + " per page");
      option.value = String(size);
      option.selected = size === state.size;
      select.appendChild(option);
    });
    select.addEventListener("change", function () {
      state.size = Number(select.value);
      saveSize(state.size);
      goTo(1);
    });
    nav.appendChild(select);
  }

  function render(entries) {
    list.replaceChildren();
    entries.forEach(function (entry) {
      var node = entry.kind === "call" ? renderCall(entry.data) : renderStatement(entry.data);
      node.dataset.key = entry.key;
      if (expanded || openKeys.has(entry.key)) { node.open = true; }
      node.addEventListener("toggle", function () {
        if (node.open) { openKeys.add(entry.key); } else { openKeys.delete(entry.key); }
      });
      list.appendChild(node);
    });
    empty.hidden = entries.length > 0;
    renderPager(pagerTop);
    renderPager(pagerBottom);
    stats.textContent = state.total + (state.total === 1 ? " entry" : " entries") + (filtersActive() ? " matching" : "");
  }

  function filtersActive() {
    return Boolean(toolSelect.value || failedOnly.checked || filterInput.value.trim());
  }

  function load() {
    state.loading = true;
    return fetch("/api/entries?" + query())
      .then(function (response) { return response.json(); })
      .then(function (page) {
        state.page = page.page;
        state.pages = page.pages;
        state.total = page.total;
        render(page.entries);
      })
      .catch(function () { setStatus("down", "Could not load entries"); })
      .then(function () { state.loading = false; });
  }

  function loadTools() {
    return fetch("/api/tools")
      .then(function (response) { return response.json(); })
      .then(function (body) { body.tools.forEach(addTool); })
      .catch(function () { return; });
  }

  function goTo(page) {
    state.page = Math.max(1, page);
    state.pendingNew = 0;
    banner.hidden = true;
    load().then(function () { window.scrollTo(0, 0); });
  }

  // Page 1 refreshes itself as calls arrive; any other page would shift
  // under the reader, so it offers a jump to the newest instead.
  function onNewEntry(entry) {
    if (entry.kind === "call") { addTool(entry.data.tool); }
    if (state.page === 1 && !paused) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () { load().then(function () { flashKey(entry.key); }); }, 150);
      return;
    }
    state.pendingNew += 1;
    banner.textContent = state.pendingNew + " new " + (state.pendingNew === 1 ? "entry" : "entries") + " \u00b7 show newest";
    banner.hidden = false;
  }

  function flashKey(key) {
    var node = list.querySelector('[data-key="' + CSS.escape(key) + '"]');
    if (node) {
      node.classList.add("fresh");
      setTimeout(function () { node.classList.remove("fresh"); }, 1300);
    }
  }

  function setStatus(stateName, text) {
    dot.className = "dot" + (stateName ? " " + stateName : "");
    statusText.textContent = text;
  }

  var source = new EventSource("/events");
  source.addEventListener("ready", function () { setStatus("live", "Live"); load(); loadTools(); });
  source.addEventListener("entry", function (event) {
    var entry;
    try { entry = JSON.parse(event.data); } catch (error) { return; }
    onNewEntry(entry);
  });
  source.addEventListener("error", function () { setStatus("down", "Disconnected, retrying"); });

  var filterTimer = null;
  filterInput.addEventListener("input", function () {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(function () { goTo(1); }, 250);
  });
  toolSelect.addEventListener("change", function () { goTo(1); });
  failedOnly.addEventListener("change", function () { goTo(1); });
  banner.addEventListener("click", function () { goTo(1); });

  pauseButton.addEventListener("click", function () {
    paused = !paused;
    pauseButton.classList.toggle("active", paused);
    pauseButton.textContent = paused ? "Resume" : "Pause";
    if (!paused && state.pendingNew > 0 && state.page === 1) { goTo(1); }
  });

  expandButton.addEventListener("click", function () {
    expanded = !expanded;
    expandButton.textContent = expanded ? "Collapse all" : "Expand all";
    list.querySelectorAll("details.entry").forEach(function (node) { node.open = expanded; });
  });

  load();
  loadTools();
})();
`;
