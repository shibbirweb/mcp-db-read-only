import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionUrlParser } from "../../../dist/connections/ConnectionUrlParser.js";

const parser = new ConnectionUrlParser();
const parse = (url) => parser.parse(url);

describe("each engine's URL", () => {
  test("mysql", () => {
    const props = parse("mysql://reader:pw@db.local:3307/app");
    assert.equal(props.engine, "mysql");
    assert.deepEqual(props.hosts, [{ host: "db.local", port: 3307 }]);
    assert.equal(props.user, "reader");
    assert.equal(props.password, "pw");
    assert.equal(props.database, "app");
  });

  test("mariadb is the mysql engine", () => {
    assert.equal(parse("mariadb://u@db/app").engine, "mysql");
  });

  test("postgres and postgresql", () => {
    assert.equal(parse("postgres://u@db/app").engine, "postgres");
    assert.equal(parse("postgresql://u@db/app").hosts[0].port, 5432);
  });

  test("mssql and sqlserver", () => {
    assert.equal(parse("sqlserver://sa@db/master").engine, "mssql");
    assert.equal(parse("mssql://sa@db/master").hosts[0].port, 1433);
  });

  test("clickhouse over http and https, with its HTTP ports", () => {
    assert.equal(parse("clickhouse://default@db").hosts[0].port, 8123);
    assert.equal(parse("clickhouse+https://default@db").hosts[0].port, 8443);
  });

  test("clickhouse defaults its database to default", () => {
    assert.equal(parse("clickhouse://db").database, "default");
  });

  test("redis database number comes from the path", () => {
    const props = parse("redis://:secret@cache:6380/4");
    assert.equal(props.engine, "redis");
    assert.equal(props.user, "");
    assert.equal(props.password, "secret");
    assert.equal(props.database, "4");
  });

  test("redis defaults to database 0", () => {
    assert.equal(parse("redis://cache").database, "0");
  });

  test("rediss is redis over TLS", () => {
    assert.equal(parse("rediss://cache").scheme, "rediss");
  });

  test("elasticsearch and opensearch", () => {
    assert.equal(parse("elasticsearch://elastic:pw@es:9200").engine, "elasticsearch");
    assert.equal(parse("opensearch+https://os").hosts[0].port, 9200);
  });
});

describe("mongodb", () => {
  test("a replica set with several hosts", () => {
    const props = parse("mongodb://u:p@a:27017,b:27018,c/app?replicaSet=rs0");
    assert.deepEqual(props.hosts, [
      { host: "a", port: 27017 },
      { host: "b", port: 27018 },
      { host: "c", port: 27017 },
    ]);
    assert.equal(props.options.replicaSet, "rs0");
  });

  test("mongodb+srv has no port", () => {
    const props = parse("mongodb+srv://u:p@cluster0.example.net/app");
    assert.deepEqual(props.hosts, [{ host: "cluster0.example.net", port: 0 }]);
  });

  test("mongodb+srv rejects a port", () => {
    assert.throws(() => parse("mongodb+srv://cluster0.example.net:27017/app"), /must not include a port/);
  });

  test("a database is optional", () => {
    assert.equal(parse("mongodb://db").database, "");
  });
});

describe("sqlite paths", () => {
  test("three slashes is an absolute path", () => {
    assert.equal(parse("sqlite:///data/app.db").database, "/data/app.db");
  });

  test("two slashes and no slashes are relative", () => {
    assert.equal(parse("sqlite://app.db").database, "app.db");
    assert.equal(parse("sqlite:app.db").database, "app.db");
  });

  test("a path containing @ and : is not read as credentials or a port", () => {
    assert.equal(parse("sqlite:///data/team@home:2026.db").database, "/data/team@home:2026.db");
  });

  test("percent-encoding in the path is decoded", () => {
    assert.equal(parse("sqlite:///data/my%20file.db").database, "/data/my file.db");
  });

  test("an empty path is refused", () => {
    assert.throws(() => parse("sqlite://"), /file path/);
  });

  test("an in-memory database is refused, since read-only it is always empty", () => {
    assert.throws(() => parse("sqlite::memory:"), /always empty/);
  });
});

describe("credentials", () => {
  test("percent-encoded characters are decoded", () => {
    const props = parse("postgres://us%40er:p%2Fw%3Ad@db/app");
    assert.equal(props.user, "us@er");
    assert.equal(props.password, "p/w:d");
  });

  test("an unencoded @ in the password splits at the last @", () => {
    assert.equal(parse("mysql://u:p@ss@db/app").password, "p@ss");
  });

  test("malformed percent-encoding is an error that does not echo the URL", () => {
    assert.throws(
      () => parse("mysql://u:bad%zzsecret@db/app"),
      (error) => /percent-encoding/.test(error.message) && !error.message.includes("secret")
    );
  });

  test("a password-like query parameter is kept out of the public options", () => {
    const props = parse("elasticsearch://es?api_key=abc123&timeout=5s");
    assert.equal(props.secretOptions.api_key, "abc123");
    assert.equal(props.options.api_key, undefined);
    assert.equal(props.options.timeout, "5s");
  });
});

describe("hosts and ports", () => {
  test("IPv6 hosts in brackets", () => {
    assert.deepEqual(parse("postgres://u@[::1]:6543/app").hosts, [{ host: "::1", port: 6543 }]);
    assert.deepEqual(parse("postgres://u@[::1]/app").hosts, [{ host: "::1", port: 5432 }]);
  });

  test("a non-numeric port is refused", () => {
    assert.throws(() => parse("mysql://db:abc/app"), /port must be a number/);
  });

  test("an out-of-range port is refused", () => {
    assert.throws(() => parse("mysql://db:70000/app"), /port must be a number/);
  });

  test("a missing host is refused", () => {
    assert.throws(() => parse("mysql://u@/app"), /host is missing/);
  });

  test("several hosts are refused where the engine takes one", () => {
    assert.throws(() => parse("postgres://a,b/app"), /single host/);
  });
});

describe("malformed input", () => {
  test("an unknown scheme lists the supported ones", () => {
    assert.throws(() => parse("oracle://db/app"), /unsupported scheme "oracle".*mysql/);
  });

  test("no scheme at all is refused", () => {
    assert.throws(() => parse("just some text"), /expected <scheme>/);
  });

  test("a scheme without // is refused for networked engines", () => {
    assert.throws(() => parse("mysql:db/app"), /expected "mysql:\/\/"/);
  });

  test("a database in an Elasticsearch URL is refused", () => {
    assert.throws(() => parse("elasticsearch://es/logs"), /do not take a database/);
  });

  test("error messages never contain the password", () => {
    const urls = ["mysql://u:hunter2@db:notaport/app", "oracle://u:hunter2@db/app", "postgres://u:hunter2@a,b/app"];
    for (const url of urls) {
      assert.throws(() => parse(url), (error) => !error.message.includes("hunter2"), url);
    }
  });
});
