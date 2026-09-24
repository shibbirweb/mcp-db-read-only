# Testing

`node:test`, no framework. Tests import from `dist/`, so `npm test` builds first.

## Layout

```
test/
  unit/                     mirrors src/; no database, no environment
  integration/
    handshake.test.js       tool list and annotations; needs no server
    sqlite.test.js          always runs, against a temporary file
    logging.test.js         the call log through a real server, against SQLite; always runs
    mysql.test.js ...       one entry file per server engine
  helpers/
    client.js               minimal MCP client over stdio
    engineSuite.js          the suite every engine runs
    targets.js              ConnectionTarget builders for unit tests
    engines/                one fixture per engine, plus sql.js shared by the SQL ones
```

## Unit tests

Everything with logic is unit tested with fakes, which the constructor injection throughout `src/` makes possible: `ConnectionManager` with a fake verifier, `DriverCache` with a fake registry, `RedisCommandFlagsGuard` with a fake `COMMAND INFO`, `ElasticsearchDriver` with a fake `fetch` that records every URL and header.

The SQL validator has the largest suite, because it is the most security-critical code. `SqlSkeletonizer.test.js` pins each dialect's lexing, including the specific attacks each rule exists for (the PostgreSQL backslash trick, a quote inside a dollar string, a quote inside SQL Server brackets). `ReadOnlyQueryValidator.test.js` runs every dialect against corpora of writes, stacked statements, smuggled writes, forbidden functions and legitimate reads that a careless rule would reject.

## Integration tests

```mermaid
flowchart TD
    E["test/integration/postgres.test.js<br/><i>one entry file per engine</i>"] --> SU
    FX["test/helpers/engines/postgres.js<br/><i>seed data, expectations, engine tests</i>"] --> SU
    SU["<b>engineSuite.js</b><br/>browsing, switching, per-call override"] --> MC["McpClient<br/>over stdio"]
    MC --> SRV["the built server<br/>dist/index.js"] --> DB[("the engine")]
    FX -->|"layer-two proof:<br/>a write straight to the driver"| DB
    SU -.->|"engine unreachable"| SK["skipped, printing<br/>'not reachable'<br/>(a failure in CI)"]
```

Every engine runs the same suite, `engineSuite.js`, driven by a fixture that supplies seed data, expectations and engine-specific tests. The shared part covers browsing, database switching and the per-call override; the fixture adds the query tools and, for every engine, a **layer-two proof**: a write sent straight to the driver, bypassing every validator, which must be refused or undone by the server.

Fixtures create and drop only data named `mcp_test*`. The Redis fixture uses databases 14 and 15 and deletes only its own prefixed keys, so running the suite against a developer's own Redis loses nothing.

### Skipping, and why CI refuses to

A fixture whose server is unreachable skips its suite and prints `integration tests skipped, <Engine> not reachable: <reason>`. That keeps `npm test` usable on a laptop with only some engines running. CI treats that phrase as a failure, because a broken service container would otherwise pass as a green build.

### Running them

```bash
./scripts/test-in-docker.sh                          # every engine, nothing installed locally
ENGINES="postgres mongodb" ./scripts/test-in-docker.sh
MYSQL_IMAGE=mariadb:11.4 ENGINES=mysql ./scripts/test-in-docker.sh
```

Or point the suites at servers of your own:

| Variable | Default |
| --- | --- |
| `TEST_MYSQL_URL` | `mysql://root:test_root_pw@127.0.0.1:3306` |
| `TEST_POSTGRES_URL` | `postgres://postgres:test_root_pw@127.0.0.1:5432` |
| `TEST_MSSQL_URL` | `mssql://sa:Test_root_pw1@127.0.0.1:1433` |
| `TEST_CLICKHOUSE_URL` | `clickhouse://default:test_root_pw@127.0.0.1:8123` |
| `TEST_MONGODB_URL` | `mongodb://root:test_root_pw@127.0.0.1:27017` |
| `TEST_REDIS_URL` | `redis://:test_root_pw@127.0.0.1:6379` |
| `TEST_ELASTICSEARCH_URL` | `elasticsearch://127.0.0.1:9200` |

The SQL Server image is published for amd64 only; on Apple Silicon Docker emulates it, which works but takes a minute or two to start.

## The client helper

`McpClient` sends one request at a time and waits for its answer. Requests written in a batch are handled concurrently by the server, so a `use_database` batched with a query is not ordered against it, and tests written that way fail intermittently. `close()` sends SIGTERM, since the server deliberately does not exit when stdin closes.

## Note on test discovery

`node --test` with no arguments runs every `.js` file under `test/`, helpers included. Helpers must therefore do nothing at import time that needs undoing: the SQLite fixture creates its temporary directory in `seed()`, not at module load, for exactly this reason.
