import { ConnectionTarget } from "../../dist/domain/ConnectionTarget.js";

/**
 * Builds a ConnectionTarget for unit tests with every field filled in, so a
 * test states only what it is about.
 */
export function target(overrides = {}) {
  return new ConnectionTarget({
    engine: "mysql",
    scheme: "mysql",
    hosts: [{ host: "db", port: 3306 }],
    user: "reader",
    password: "",
    database: "app",
    options: {},
    secretOptions: {},
    ...overrides,
  });
}

/** A target on the named engine, with a plausible scheme and port. */
export function engineTarget(engine, overrides = {}) {
  const defaults = {
    mysql: { scheme: "mysql", hosts: [{ host: "db", port: 3306 }] },
    postgres: { scheme: "postgres", hosts: [{ host: "db", port: 5432 }] },
    sqlite: { scheme: "sqlite", hosts: [], user: "", database: "/data/app.db" },
    mssql: { scheme: "mssql", hosts: [{ host: "db", port: 1433 }] },
    clickhouse: { scheme: "clickhouse", hosts: [{ host: "db", port: 8123 }] },
    mongodb: { scheme: "mongodb", hosts: [{ host: "db", port: 27017 }] },
    redis: { scheme: "redis", hosts: [{ host: "db", port: 6379 }], user: "", database: "0" },
    elasticsearch: { scheme: "elasticsearch", hosts: [{ host: "db", port: 9200 }], database: "" },
  };
  return target({ engine, ...defaults[engine], ...overrides });
}
