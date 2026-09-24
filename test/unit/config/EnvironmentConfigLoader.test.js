import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EnvironmentConfigLoader } from "../../../dist/config/EnvironmentConfigLoader.js";

/** The environment is a constructor argument, so each test is an object literal. */
const load = (env) => new EnvironmentConfigLoader(env).load();
const names = (config) => config.profiles.map((profile) => profile.name);

describe("DB_URL", () => {
  test("becomes a profile named default", () => {
    const config = load({ DB_URL: "postgres://reader@db/app" });
    assert.deepEqual(names(config), ["default"]);
    assert.equal(config.profiles[0].target.engine, "postgres");
  });

  test("DB_PASSWORD supplies its password separately", () => {
    const config = load({ DB_URL: "postgres://reader@db/app", DB_PASSWORD: "p@ss#word" });
    assert.equal(config.profiles[0].target.password, "p@ss#word");
  });

  test("an unparseable URL is a warning, not a crash", () => {
    const config = load({ DB_URL: "oracle://db/app" });
    assert.deepEqual(config.profiles, []);
    assert.match(config.warnings[0], /DB_URL.*unsupported scheme/);
  });
});

describe("DB_PROFILES", () => {
  test("accepts plain URL strings", () => {
    const config = load({
      DB_PROFILES: JSON.stringify({ pg: "postgres://u@db/app", cache: "redis://cache/2" }),
    });
    assert.deepEqual(names(config), ["pg", "cache"]);
    assert.equal(config.profiles[1].target.database, "2");
  });

  test("accepts objects with a separate password", () => {
    const config = load({
      DB_PROFILES: JSON.stringify({ pg: { url: "postgres://u@db/app", password: "p/w@#" } }),
    });
    assert.equal(config.profiles[0].target.password, "p/w@#");
  });

  test("one broken profile is skipped with a warning and the rest load", () => {
    const config = load({
      DB_PROFILES: JSON.stringify({ good: "mysql://u@db/app", bad: "mysql://u@db:nope/app", odd: 42 }),
    });
    assert.deepEqual(names(config), ["good"]);
    assert.equal(config.warnings.length, 2);
  });

  test("invalid JSON is a warning", () => {
    const config = load({ DB_PROFILES: "{not json" });
    assert.match(config.warnings[0], /DB_PROFILES is not valid JSON/);
  });

  test("an array is refused, since profiles need names", () => {
    const config = load({ DB_PROFILES: "[]" });
    assert.match(config.warnings[0], /must be a JSON object/);
  });

  test("a default defined here wins over DB_URL", () => {
    const config = load({
      DB_PROFILES: JSON.stringify({ default: "mysql://u@one/app" }),
      DB_URL: "mysql://u@two/app",
    });
    assert.equal(config.profiles[0].target.host, "one");
  });

  test("warnings never contain a password", () => {
    const config = load({ DB_PROFILES: JSON.stringify({ bad: "mysql://u:hunter2@db:nope/app" }) });
    assert.ok(!config.warnings.join(" ").includes("hunter2"));
  });
});

describe("the legacy MySQL configuration still works unchanged", () => {
  test("MYSQL_HOST, MYSQL_USER and MYSQL_DATABASE become default", () => {
    const config = load({
      MYSQL_HOST: "legacy",
      MYSQL_PORT: "3307",
      MYSQL_USER: "u",
      MYSQL_PASSWORD: "p",
      MYSQL_DATABASE: "app",
    });
    const target = config.profiles[0].target;
    assert.equal(target.engine, "mysql");
    assert.equal(target.host, "legacy");
    assert.equal(target.port, 3307);
    assert.equal(target.password, "p");
  });

  test("MYSQL_PROFILES objects load as MySQL profiles", () => {
    const config = load({
      MYSQL_PROFILES: JSON.stringify({ staging: { host: "s", user: "u", database: "d" } }),
    });
    assert.equal(config.profiles[0].target.engine, "mysql");
    assert.equal(config.profiles[0].name, "staging");
  });

  test("a name in DB_PROFILES wins over the same name in MYSQL_PROFILES, with a warning", () => {
    const config = load({
      DB_PROFILES: JSON.stringify({ staging: "postgres://u@pg/app" }),
      MYSQL_PROFILES: JSON.stringify({ staging: { user: "u", database: "d" } }),
    });
    assert.equal(config.profiles.length, 1);
    assert.equal(config.profiles[0].target.engine, "postgres");
    assert.match(config.warnings[0], /DB_PROFILES already defines it/);
  });

  test("DB_URL wins the default name over MYSQL_USER", () => {
    const config = load({ DB_URL: "redis://cache", MYSQL_USER: "u", MYSQL_DATABASE: "d" });
    assert.equal(config.profiles.length, 1);
    assert.equal(config.profiles[0].target.engine, "redis");
  });

  test("MYSQL_DEFAULT_PROFILE is honoured when DB_DEFAULT_PROFILE is absent", () => {
    assert.equal(load({ MYSQL_DEFAULT_PROFILE: "x" }).defaultProfileName, "x");
    assert.equal(load({ MYSQL_DEFAULT_PROFILE: "x", DB_DEFAULT_PROFILE: "y" }).defaultProfileName, "y");
  });
});

describe("timeouts", () => {
  test("default when unset", () => {
    const config = load({});
    assert.equal(config.queryTimeoutMs, EnvironmentConfigLoader.DEFAULT_QUERY_TIMEOUT_MS);
    assert.equal(config.connectTimeoutMs, EnvironmentConfigLoader.DEFAULT_CONNECT_TIMEOUT_MS);
  });

  test("DB_* is read, with MYSQL_* as the fallback", () => {
    assert.equal(load({ DB_QUERY_TIMEOUT_MS: "5000" }).queryTimeoutMs, 5000);
    assert.equal(load({ MYSQL_QUERY_TIMEOUT_MS: "7000" }).queryTimeoutMs, 7000);
    assert.equal(load({ DB_CONNECT_TIMEOUT_MS: "1500" }).connectTimeoutMs, 1500);
  });

  test("garbage and non-positive values fall back to the default", () => {
    assert.equal(load({ DB_QUERY_TIMEOUT_MS: "soon" }).queryTimeoutMs, 30000);
    assert.equal(load({ DB_QUERY_TIMEOUT_MS: "-1" }).queryTimeoutMs, 30000);
  });
});

describe("call logging", () => {
  test("is off by default", () => {
    assert.deepEqual(load({}).logging, {
      enabled: false,
      text: false,
      file: null,
      directory: null,
      format: "pretty",
      viewerPort: null,
      viewerHistory: 500,
    });
  });

  test("DB_LOG=true logs to stderr", () => {
    const logging = load({ DB_LOG: "true" }).logging;
    assert.equal(logging.enabled, true);
    assert.equal(logging.file, null);
  });

  test("DB_LOG_FILE implies logging, to that file, made absolute", () => {
    const logging = load({ DB_LOG_FILE: "logs/calls.log" }).logging;
    assert.equal(logging.enabled, true);
    assert.ok(logging.file.startsWith("/") && logging.file.endsWith("logs/calls.log"), logging.file);
  });

  test("DB_LOG_FORMAT=json picks JSON lines", () => {
    assert.equal(load({ DB_LOG: "1", DB_LOG_FORMAT: "JSON" }).logging.format, "json");
  });

  test("an unknown format is a warning, and pretty is used", () => {
    const config = load({ DB_LOG: "1", DB_LOG_FORMAT: "xml" });
    assert.equal(config.logging.format, "pretty");
    assert.match(config.warnings[0], /DB_LOG_FORMAT="xml"/);
  });

  test("DB_LOG_DIR saves to a folder, turns logging on, and writes no text", () => {
    const logging = load({ DB_LOG_DIR: "logs" }).logging;
    assert.equal(logging.enabled, true);
    assert.equal(logging.text, false);
    assert.ok(logging.directory.startsWith("/") && logging.directory.endsWith("/logs"), logging.directory);
  });

  test("DB_LOG_DIR combines with DB_LOG", () => {
    const logging = load({ DB_LOG_DIR: "logs", DB_LOG: "true" }).logging;
    assert.equal(logging.text, true);
    assert.ok(logging.directory);
  });

  test("DB_LOG_PORT works with DB_LOG_DIR alone", () => {
    assert.equal(load({ DB_LOG_DIR: "logs", DB_LOG_PORT: "4800" }).logging.viewerPort, 4800);
  });

  test("DB_LOG=false stays off", () => {
    assert.equal(load({ DB_LOG: "false" }).logging.enabled, false);
  });

  test("the live viewer is off by default, with 500 entries of history", () => {
    const logging = load({ DB_LOG: "true" }).logging;
    assert.equal(logging.viewerPort, null);
    assert.equal(logging.viewerHistory, 500);
  });

  test("DB_LOG_PORT starts the viewer when logging is on", () => {
    assert.equal(load({ DB_LOG: "true", DB_LOG_PORT: "4800" }).logging.viewerPort, 4800);
    assert.equal(load({ DB_LOG_FILE: "x.log", DB_LOG_PORT: "4800" }).logging.viewerPort, 4800);
  });

  test("DB_LOG_PORT alone does nothing, and says why", () => {
    const config = load({ DB_LOG_PORT: "4800" });
    assert.equal(config.logging.enabled, false);
    assert.equal(config.logging.viewerPort, null);
    assert.match(config.warnings[0], /DB_LOG_PORT is set but call logging is off/);
  });

  test("an invalid port is a warning, and no viewer", () => {
    for (const port of ["http", "0", "70000", "48.5"]) {
      const config = load({ DB_LOG: "true", DB_LOG_PORT: port });
      assert.equal(config.logging.viewerPort, null, port);
      assert.match(config.warnings[0], /not a port/, port);
    }
  });

  test("DB_LOG_HISTORY sets the replay size, 0 meaning none", () => {
    assert.equal(load({ DB_LOG_HISTORY: "50" }).logging.viewerHistory, 50);
    assert.equal(load({ DB_LOG_HISTORY: "0" }).logging.viewerHistory, 0);
    assert.equal(load({ DB_LOG_HISTORY: "lots" }).logging.viewerHistory, 500);
  });
});

describe("nothing is fatal", () => {
  test("an empty environment is a valid configuration with no profiles", () => {
    const config = load({});
    assert.deepEqual(config.profiles, []);
    assert.deepEqual(config.warnings, []);
    assert.equal(config.defaultProfileName, null);
  });
});
