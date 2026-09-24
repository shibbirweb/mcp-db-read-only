import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ElasticsearchDriver } from "../../../../dist/drivers/search/ElasticsearchDriver.js";
import { engineTarget } from "../../../helpers/targets.js";

const tuning = { connectionLimit: 1, connectTimeoutMs: 1000, queryTimeoutMs: 1000 };

/** Records every request and answers with the given status and body. */
function fakeFetch(status = 200, body = {}) {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetcher, requests };
}

const driver = (fetcher, overrides = {}) =>
  new ElasticsearchDriver(engineTarget("elasticsearch", overrides), tuning, fetcher);

describe("requests are limited to fixed read endpoints", () => {
  test("search is a POST to <index>/_search", async () => {
    const { fetcher, requests } = fakeFetch(200, { hits: { hits: [] } });
    await driver(fetcher).search("logs-*", { query: { match_all: {} } });
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "http://db:9200/logs-*/_search");
  });

  test("describe is a GET of the mapping", async () => {
    const { fetcher, requests } = fakeFetch(200, {});
    await driver(fetcher).describeObject("logs");
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "http://db:9200/logs/_mapping");
  });

  test("an index name is percent-encoded, keeping commas and wildcards", async () => {
    const { fetcher, requests } = fakeFetch(200, { hits: { hits: [] } });
    await driver(fetcher).search("a,b*", {});
    assert.equal(requests[0].url, "http://db:9200/a,b*/_search");
  });

  test("https schemes use https", async () => {
    const { fetcher, requests } = fakeFetch(200, { version: { number: "8.15.0" } });
    await driver(fetcher, { scheme: "opensearch+https" }).verify();
    assert.equal(requests[0].url, "https://db:9200/");
  });
});

describe("authentication", () => {
  test("basic auth from the URL's credentials", async () => {
    const { fetcher, requests } = fakeFetch(200, { version: { number: "8" } });
    await driver(fetcher, { user: "elastic", password: "pw" }).verify();
    assert.equal(requests[0].headers.authorization, `Basic ${Buffer.from("elastic:pw").toString("base64")}`);
  });

  test("an API key wins over basic auth", async () => {
    const { fetcher, requests } = fakeFetch(200, { version: { number: "8" } });
    await driver(fetcher, { user: "elastic", secretOptions: { api_key: "k123" } }).verify();
    assert.equal(requests[0].headers.authorization, "ApiKey k123");
  });
});

describe("answers", () => {
  test("hidden indices are left out of the listing unless asked for", async () => {
    const { fetcher } = fakeFetch(200, [{ index: "logs" }, { index: ".security" }]);
    assert.deepEqual((await driver(fetcher).listObjects(undefined, 10)).names, ["logs"]);
  });

  test("a 404 on an index is reported as not found", async () => {
    const { fetcher } = fakeFetch(404, { error: { type: "index_not_found_exception", reason: "no such index" } });
    await assert.rejects(() => driver(fetcher).describeObject("ghost"), /No index named "ghost"/);
  });

  test("other errors carry the server's own reason", async () => {
    const { fetcher } = fakeFetch(400, { error: { type: "parsing_exception", reason: "unknown query [x]" } });
    await assert.rejects(() => driver(fetcher).search("logs", {}), /400: parsing_exception: unknown query/);
  });

  test("a server that is not Elasticsearch fails verification", async () => {
    const { fetcher } = fakeFetch(200, { hello: "world" });
    await assert.rejects(() => driver(fetcher).verify(), /not as Elasticsearch or OpenSearch/);
  });

  test("there are no databases", async () => {
    await assert.rejects(() => driver(fakeFetch().fetcher).listDatabases(), /has no databases/);
  });
});
