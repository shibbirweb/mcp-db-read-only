# mcp-db-read-only

[![CI](https://github.com/shibbirweb/mcp-db-read-only/actions/workflows/ci.yml/badge.svg)](https://github.com/shibbirweb/mcp-db-read-only/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40shibbirweb%2Fmcp-db-read-only?label=npm&color=cb3837)](https://www.npmjs.com/package/@shibbirweb/mcp-db-read-only)
[![Docker Hub](https://img.shields.io/docker/v/shibbirweb/mcp-db-read-only?label=docker%20hub&sort=semver)](https://hub.docker.com/r/shibbirweb/mcp-db-read-only)
[![Image size](https://img.shields.io/docker/image-size/shibbirweb/mcp-db-read-only/latest?style=flat&label=image%20size)](https://hub.docker.com/r/shibbirweb/mcp-db-read-only/tags)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that gives an AI assistant **read-only** access to your databases, whichever kind they are, and lets it **switch database, server, credentials and even engine mid-conversation without restarting the client**.

| Engine | URL scheme | Queried with |
| --- | --- | --- |
| MySQL, MariaDB | `mysql://`, `mariadb://` | `run_query` (SQL) |
| PostgreSQL (and wire-compatible) | `postgres://`, `postgresql://` | `run_query` (SQL) |
| SQLite | `sqlite:///path/to/file.db` | `run_query` (SQL) |
| SQL Server, Azure SQL | `mssql://`, `sqlserver://` | `run_query` (T-SQL) |
| ClickHouse | `clickhouse://`, `clickhouse+https://` | `run_query` (SQL) |
| MongoDB | `mongodb://`, `mongodb+srv://` | `find_documents`, `aggregate`, `count_documents`, `distinct_values` |
| Redis (and Valkey, KeyDB) | `redis://`, `rediss://` | `redis_command` |
| Elasticsearch, OpenSearch | `elasticsearch://`, `opensearch://`, `+https` variants | `search` |

The browse tools (`list_tables`, `describe_table`, `get_table_sample`, ...) work on every engine, in that engine's terms: tables, collections, keys or indices.

Runs from npm with `npx`, or entirely in Docker with nothing installed on your machine.

```mermaid
flowchart LR
    A["AI assistant<br/>Claude Desktop / Claude Code"]
    B["mcp-db-read-only<br/>one process, whole session"]
    C[("PostgreSQL<br/>app")]
    D[("MySQL<br/>legacy")]
    E[("MongoDB<br/>events")]
    F[("Redis<br/>cache")]
    G[("anything reached<br/>with connect")]

    A <-->|"MCP over stdio"| B
    B -.->|"one driver per target"| C
    B -.->|"one driver per target"| D
    B -.->|"one driver per target"| E
    B -.->|"one driver per target"| F
    B -.->|"opened at runtime"| G
```

The server lives for the whole session, so the active connection is just state inside it. Switching selects a different driver rather than reconnecting, and switching back reuses a warm one.

---

## Quick start

### npm

```bash
DB_URL='postgres://readonly:secret@127.0.0.1:5432/my_database' npx -y @shibbirweb/mcp-db-read-only
```

Requires Node 22.13 or newer. There is no container in the way, so `127.0.0.1` means what you expect.

### Docker

```bash
docker run -i --rm \
  --add-host host.docker.internal:host-gateway \
  -e DB_URL='postgres://readonly:secret@host.docker.internal:5432/my_database' \
  shibbirweb/mcp-db-read-only
```

Use `host.docker.internal` to reach a database on the same machine as Docker. Inside the container, `localhost` means the container itself.

For SQLite in Docker, mount the file's directory read-only and point at the path inside the container:

```bash
docker run -i --rm -v "$PWD/data:/data:ro" -e DB_URL='sqlite:///data/app.db' shibbirweb/mcp-db-read-only
```

The container is the more isolated of the two: the server runs with only what the image and the environment give it. Over npm it runs directly on your machine with your user's access. Both enforce the same read-only guarantees.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "databases": {
      "command": "npx",
      "args": ["-y", "@shibbirweb/mcp-db-read-only"],
      "env": {
        "DB_PROFILES": "{\"app\": \"postgres://readonly@127.0.0.1/app\", \"cache\": \"redis://127.0.0.1:6379/0\"}",
        "DB_DEFAULT_PROFILE": "app"
      }
    }
  }
}
```

Or the same server in Docker:

```json
{
  "mcpServers": {
    "databases": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--add-host", "host.docker.internal:host-gateway",
        "-e", "DB_URL=postgres://readonly:secret@host.docker.internal:5432/app",
        "shibbirweb/mcp-db-read-only"
      ]
    }
  }
}
```

### Claude Code

The same shape, in `.mcp.json` at your project root. Either form above works.

Restart the client once. After that you never need to restart it to change database.

> Credentials in these files sit on disk in plain text. Prefer read-only database accounts, and keep the file out of version control. See [Security](#security).

### Coming from mcp-mysql-read-only

This server reads the old `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_PROFILES` and `MYSQL_DEFAULT_PROFILE` unchanged, so swapping the image or package name is enough. Tool names are the same too; the one change is that `connect` now takes a URL.

---

## Switching connections

Just ask. These map onto the connection tools:

> "switch to the staging database"
> "what collections are in the events database?"
> "connect to the Redis on 10.0.0.5 and show me the session keys"

| Want | Restart? |
| --- | --- |
| Another database on the same server | No |
| Another named profile, on any engine | No |
| A different server, credentials or engine | No |
| A new permanent profile in `DB_PROFILES` | Yes, once |

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant A as Assistant
    participant S as MCP server
    participant P as PostgreSQL
    participant M as MongoDB

    You->>A: "how many signups yesterday?"
    A->>S: run_query(SELECT count(*) ...)
    S->>P: read-only transaction
    P-->>S: 4821
    A-->>You: 4821 signups

    You->>A: "and how many of them opened the app?"
    A->>S: use_connection(events)
    S->>M: connect + ping
    Note over S: verified, so the switch is committed
    A->>S: count_documents(opens, {...})
    S->>M: countDocuments
    M-->>S: 3907
    A-->>You: 3907 of them
```

A switch that fails verification is never committed, so the previous connection stays active and the session keeps working.

### Named profiles

Define several connections up front with `DB_PROFILES`, a JSON object whose values are URLs, or objects with a separate password:

```json
{
  "app":     "postgres://readonly@db.internal:5432/app",
  "legacy":  "mysql://readonly@legacy.internal/shop",
  "events":  { "url": "mongodb://reader@mongo.internal/events", "password": "p@ss/w#rd" },
  "cache":   "redis://cache.internal:6379/0",
  "logs":    "elasticsearch+https://reader@logs.internal:9200",
  "reports": "sqlite:///data/reports.db"
}
```

The object form exists because a password inside a URL must be percent-encoded, and one containing `@`, `/` or `#` otherwise splits the URL in the wrong place. A profile that fails to parse is skipped with a warning rather than taking the server down.

### Reaching somewhere not in the profiles

The `connect` tool takes a URL (and optionally a separate password) at runtime and keeps it for the rest of the session under an alias. Nothing is written to disk, and no restart is involved.

### URL details

| Engine | Notes |
| --- | --- |
| MySQL | `?ssl=true` requires TLS; `?ssl-mode=VERIFY_IDENTITY` also checks the certificate |
| PostgreSQL | `?sslmode=require`, `verify-ca` or `verify-full`, as in libpq |
| SQLite | `sqlite:///absolute/path.db`; a relative path is resolved once, at startup |
| SQL Server | Encrypted by default. `?trustServerCertificate=true` for self-signed development servers; `?applicationIntent=ReadOnly` routes to a readable secondary |
| ClickHouse | The HTTP interface: port 8123, or 8443 with `clickhouse+https` |
| MongoDB | Replica sets as `mongodb://a:27017,b:27017/db?replicaSet=rs0`; any driver option passes through the query string |
| Redis | The path is the database number: `redis://host:6379/3` |
| Elasticsearch | `?api_key=...` authenticates with an API key; it is treated as a secret and never displayed |

---

## Tools

### Connection

| Tool | Purpose |
| --- | --- |
| `current_connection` | Which engine, server and database is active |
| `list_connections` | Available profiles and their engines, `*` marks the active one |
| `list_databases` | Databases on the connected server |
| `use_database` | Switch database on the current server |
| `use_connection` | Switch to a named profile, optional `database` override |
| `connect` | Open any server from a URL, optional `alias` |

### Browsing, on every engine

| Tool | SQL engines | MongoDB | Redis | Elasticsearch |
| --- | --- | --- | --- | --- |
| `list_tables` | tables and views | collections | keys, by SCAN | indices |
| `describe_table` | columns | fields inferred from 100 sampled documents | type, TTL, length | mapping |
| `get_table_indexes` | indexes | indexes | n/a | n/a |
| `get_foreign_keys` | foreign keys (not ClickHouse) | n/a | n/a | n/a |
| `get_table_sample` | up to 50 rows | up to 50 documents | the start of the value | up to 50 hits |

`list_tables` takes an optional glob `pattern`, such as `user*`, which is how you browse a Redis instance with millions of keys.

### Querying, per engine family

| Tool | Engine | Accepts |
| --- | --- | --- |
| `run_query` | SQL engines | One read-only statement in the engine's own dialect |
| `find_documents` | MongoDB | Filter, projection, sort, limit and skip, as Extended JSON |
| `aggregate` | MongoDB | A pipeline, without `$out` or `$merge` |
| `count_documents` | MongoDB | A filter |
| `distinct_values` | MongoDB | A field and an optional filter |
| `search` | Elasticsearch, OpenSearch | A Query DSL body; `size: 0` with `track_total_hits` counts |
| `redis_command` | Redis | One read-only command and its arguments |

Every tool is advertised all the time, since MCP fixes the tool list at startup while the active engine can change. Calling one against the wrong engine says which tools fit instead.

Every reading tool also accepts an optional `database`, applied to that call only, leaving the active connection alone.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_URL` | none | One connection, registered as the profile `default` |
| `DB_PASSWORD` | none | Password for `DB_URL`, so it need not be encoded into the URL |
| `DB_PROFILES` | none | JSON object of named profiles |
| `DB_DEFAULT_PROFILE` | none | Which profile starts active |
| `DB_QUERY_TIMEOUT_MS` | `30000` | Statement timeout, enforced by each server where it can be |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Connection timeout |
| `MYSQL_*` | | The legacy MySQL-only variables, read unchanged. See above |

None of these are required: with no configuration at all the server still starts, and the tools tell you to call `connect`.

Starting profile: `DB_DEFAULT_PROFILE` (or `MYSQL_DEFAULT_PROFILE`) if it names a real profile, else `default`, else the first one defined.

---

## Security

Every engine is kept read-only by **two independent layers**, so a hole in one is not automatically a write. The first layer runs before any connection is used; the second is enforced by the database server itself wherever the engine offers a way, and structurally where it does not.

| Engine | Layer one, in this server | Layer two |
| --- | --- | --- |
| MySQL, MariaDB | SQL validator | `SET SESSION TRANSACTION READ ONLY` on every connection; the driver cannot send a second statement |
| PostgreSQL | SQL validator, dialect-aware (dollar quotes, `E''` strings) | Every statement runs in a `READ ONLY` transaction that is always rolled back; extended query protocol, one statement only |
| SQLite | SQL validator | The file is opened read-only by SQLite; extensions disabled |
| SQL Server | SQL validator, scanning every statement since T-SQL needs no separators | Every batch runs in a transaction that is always rolled back |
| ClickHouse | SQL validator, refusing table functions that reach outside the server | ClickHouse's own `readonly` setting on every query |
| MongoDB | Operator denylist: `$out`, `$merge`, `$function`, `$where` anywhere | Stage allowlist in the driver, which only ever calls read operations |
| Redis | Command allowlist | The server's own `COMMAND INFO` flags: a command is sent only if Redis itself calls it read-only |
| Elasticsearch | Search body allowlist; index names cannot address an API | The driver can only reach fixed read endpoints |

The SQL validator lexes each dialect exactly as the server will: string literals, quoted identifiers and comments are blanked before any rule looks at the statement, so a keyword or semicolon inside a literal is never mistaken for SQL. Constructs it cannot be certain the server reads the same way, such as nested block comments or MySQL's executable `/*! */` comments, are refused rather than guessed at. Only the dialect's read statements may lead (`SELECT`, `WITH`, and `SHOW`, `DESCRIBE` or `EXPLAIN` where they exist). Functions that write files, reach other servers or run SQL hidden in a string (`INTO OUTFILE`, `lo_export`, `dblink`, `OPENROWSET`, ClickHouse's `url()` and `file()`) are blocked.

Integration tests prove layer two separately: they send writes straight to each driver, bypassing every validator, and assert the server refused or undid them.

### What this is not

**This is a guard, not a permission system.** It stops an assistant from writing through *this* server. It does not stop anyone holding the same credentials from writing through any other client.

**Point it at read-only accounts.** This is the real protection, and on MongoDB and Elasticsearch, whose servers have no read-only session mode, it is the only server-side one:

```sql
-- MySQL
CREATE USER 'readonly'@'%' IDENTIFIED BY '...'; GRANT SELECT ON app.* TO 'readonly'@'%';
-- PostgreSQL
CREATE ROLE readonly LOGIN PASSWORD '...'; GRANT pg_read_all_data TO readonly;
```

```js
// MongoDB
db.createUser({ user: "reader", pwd: "...", roles: [{ role: "read", db: "app" }] });
```

```text
# Redis
ACL SETUSER reader on >... ~* +@read -@dangerous
```

Other limits worth knowing:

- Results are truncated to 100 rows in the tool output. Add a `LIMIT` (or `$limit`) when reading large tables.
- A column named exactly like a write keyword must be quoted where the validator scans for them: inside `WITH` queries, and in every SQL Server statement.
- SQLite queries run in a separate process, so one that exceeds the timeout can be killed outright.

---

## Known behaviour

**Parallel tool calls.** The active connection is a single piece of process state. If a client issues several tool calls in one batch they are handled concurrently, so a `use_database` batched alongside a query is not guaranteed to land first. When a read must be pinned to a particular database, pass the per-call `database` argument instead.

**Shutdown.** The server exits on `SIGINT`/`SIGTERM`, not when stdin closes. Open sockets keep the event loop alive, and stdin reaching EOF only means no further requests were buffered.

---

## Development

Everything runs in Docker, so a clone and Docker are the only requirements:

```bash
git clone https://github.com/shibbirweb/mcp-db-read-only.git
cd mcp-db-read-only
./scripts/test-in-docker.sh                         # every engine
ENGINES="postgres redis" ./scripts/test-in-docker.sh # a subset
```

That starts a throwaway container per engine, builds the test image, runs the full suite against them and tears everything down. Your own databases are never touched.

With Node 22.13 or newer installed locally:

```bash
npm ci
npm run build
npm run test:unit   # no database needed
npm test            # integration suites skip any engine they cannot reach
```

The SQLite and handshake suites need no server and always run. The others read `TEST_MYSQL_URL`, `TEST_POSTGRES_URL`, `TEST_MSSQL_URL`, `TEST_CLICKHOUSE_URL`, `TEST_MONGODB_URL`, `TEST_REDIS_URL` and `TEST_ELASTICSEARCH_URL`, and create and drop scratch data named `mcp_test*`, so point them at disposable servers.

### Project structure

```
src/
  index.ts                Entry point
  ApplicationFactory.ts   Composition root: the only file that wires things, and the only one naming a driver
  types/                  Interfaces and type aliases, one file per concern
  errors/                 Named error classes
  domain/                 Engine catalog, ConnectionTarget, ConnectionProfile
  config/                 Reading configuration from the environment
  connections/            URL parser, target factory, profile registry, connection manager
  drivers/                DatabaseDriver strategy, registry, LRU cache, and sql/ document/ keyvalue/ search/
  validation/             sql/ (dialects, skeletonizer, rules), document/, keyvalue/, search/, names/
  formatting/             Response, row and JSON rendering
  tools/                  BaseTool, DatabaseScopedTool, connection/ browse/ sql/ document/ search/ keyvalue/
  server/                 McpDbServer
```

Developer documentation, including why each part is built the way it is, lives in the [wiki](https://github.com/shibbirweb/mcp-db-read-only/wiki) (source in [`docs/wiki/`](docs/wiki/)).

---

## Contributing

Pull requests target `master`. CI runs the full suite against every engine, twice (once with MySQL, once with MariaDB), and builds the image for amd64 and arm64. Please keep changes covered by tests, and update `docs/wiki/` when behaviour changes.

There is a second copy of this document, [`README.dockerhub.md`](README.dockerhub.md), which is published as the Docker Hub description. Docker Hub renders neither mermaid nor relative links, so that copy uses ASCII diagrams and absolute URLs. **If you change user-facing behaviour here, change it there too.**

## Changelog

Release history is in [CHANGELOG.md](CHANGELOG.md).

## Privacy

The server sends nothing anywhere except to the databases you point it at: no telemetry, no analytics, nothing written to disk, nothing kept after it exits. What does leave your machine is whatever your assistant reads, since query results become conversation content. [PRIVACY.md](PRIVACY.md) sets out both halves.

## License

[MIT](LICENSE) © Md. Shibbir Ahmed
