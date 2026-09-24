import { test } from "node:test";
import assert from "node:assert/strict";
import { reason } from "./sql.js";

const BASE = process.env.TEST_ELASTICSEARCH_URL ?? "elasticsearch://127.0.0.1:9200";
const http = BASE.replace(/^(elasticsearch|opensearch)(\+https)?:/, (_, __, secure) => (secure ? "https:" : "http:"));
const PREFIX = "mcp_test_";

async function request(method, path, body) {
  const response = await fetch(`${http}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return response;
}

export default {
  label: "Elasticsearch",
  database: "",
  objects: [`${PREFIX}authors`, `${PREFIX}books`],
  pattern: { glob: `${PREFIX}auth*`, includes: `${PREFIX}authors`, excludes: `${PREFIX}books` },
  describe: { name: `${PREFIX}authors`, match: /"name"/ },
  sample: { name: `${PREFIX}books`, match: /Earthsea|Mort/ },
  missing: `${PREFIX}ghost`,
  alt: null,

  profiles: () => ({ search: BASE }),

  async probe() {
    try {
      const response = await request("GET", "/");
      return response.ok ? null : `HTTP ${response.status}`;
    } catch (error) {
      return reason(error);
    }
  },

  async seed() {
    await this.teardown();
    const bulk = [
      { index: { _index: `${PREFIX}authors`, _id: "1" } },
      { name: "Ursula", country: "US" },
      { index: { _index: `${PREFIX}authors`, _id: "2" } },
      { name: "Terry", country: "UK" },
      { index: { _index: `${PREFIX}books`, _id: "1" } },
      { title: "A Wizard of Earthsea", year: 1968 },
      { index: { _index: `${PREFIX}books`, _id: "2" } },
      { title: "Mort", year: 1987 },
    ];
    const response = await request("POST", "/_bulk?refresh=true", `${bulk.map((line) => JSON.stringify(line)).join("\n")}\n`);
    assert.ok(response.ok, `bulk load failed: ${response.status}`);
  },

  async teardown() {
    await request("DELETE", `/${PREFIX}authors,${PREFIX}books?ignore_unavailable=true`);
  },

  extraTests(call) {
    test("search finds a match", async () => {
      const { text, isError } = await call("search", {
        index: `${PREFIX}books`,
        body: { query: { match: { title: "wizard" } } },
      });
      assert.equal(isError, false, text);
      assert.match(text, /A Wizard of Earthsea/);
    });

    test("size 0 with track_total_hits is a count", async () => {
      const { text } = await call("search", { index: `${PREFIX}*`, body: { size: 0, track_total_hits: true } });
      assert.equal(JSON.parse(text).total.value, 4);
    });

    test("an unsupported body key is refused", async () => {
      const { text, isError } = await call("search", { index: `${PREFIX}books`, body: { scroll: "1m" } });
      assert.equal(isError, true);
      assert.match(text, /scroll/);
    });

    test("an index name aimed at an API is refused before any request", async () => {
      const { text, isError } = await call("search", { index: "_security", body: {} });
      assert.equal(isError, true);
      assert.match(text, /cannot start with _/);
    });

    test("list_databases says there are none and where to look instead", async () => {
      const { text } = await call("list_databases");
      assert.match(text, /no databases.*list_tables/);
    });
  },
};
