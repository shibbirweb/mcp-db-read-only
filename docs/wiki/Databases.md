# Databases

One section per database: how to write the connection URL, how to create a read-only account, what the tools show there, and examples.

Two things are the same everywhere:

- **Browse tools work on every database**: `list_tables`, `describe_table`, `get_table_sample`, and, where the database has them, `get_table_indexes` and `get_foreign_keys`. The [Using the Tools](Using-the-Tools) page explains each one.
- **Each family has its own query tool**: `run_query` for SQL databases, `find_documents` and friends for MongoDB, `redis_command` for Redis, `search` for Elasticsearch. Ask for the wrong one and the server tells the assistant which one to use.

**Use a read-only account.** The server refuses writes on its own, but a read-only account means nothing can ever write, whatever happens. Each section shows how to create one.

---

## MySQL and MariaDB

**URL**

```text
mysql://USER:PASSWORD@HOST:3306/DATABASE
mariadb://USER:PASSWORD@HOST:3306/DATABASE
```

| Option | Meaning |
| --- | --- |
| `?ssl=true` | Require TLS |
| `?ssl-mode=VERIFY_IDENTITY` | Require TLS and check the certificate |

The database is optional; without it, ask the assistant to list databases and switch to one.

**Read-only account**

```sql
CREATE USER 'readonly'@'%' IDENTIFIED BY 'a strong password';
GRANT SELECT, SHOW VIEW ON shop.* TO 'readonly'@'%';
```

**What you'll see**

- `list_databases`: the schemas on the server, without `mysql`, `sys` and the other internal ones (ask for "system databases too" to include them).
- `describe_table`: columns, types, keys and defaults (`SHOW COLUMNS`).
- `get_table_indexes`, `get_foreign_keys`: both supported.
- `run_query`: `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC` and `EXPLAIN`.

**Example**

```json
{ "tool": "run_query", "arguments": { "query": "SELECT status, COUNT(*) AS n FROM orders GROUP BY status" } }
```

**Worth knowing**

- `INTO OUTFILE`, `LOAD DATA`, `SLEEP()` and `BENCHMARK()` are refused.
- A column named after a write keyword (`update`, `delete`) inside a `WITH` query must be quoted with backticks.

---

## PostgreSQL

Also works with hosted and extended PostgreSQL, such as Supabase, Neon, TimescaleDB and Amazon RDS / Aurora for PostgreSQL.

**URL**

```text
postgres://USER:PASSWORD@HOST:5432/DATABASE
postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

| Option | Meaning |
| --- | --- |
| `?sslmode=require` | Use TLS without checking the certificate (like `psql`) |
| `?sslmode=verify-full` | Use TLS and check the certificate |

**Read-only account** (PostgreSQL 14 and newer)

```sql
CREATE ROLE readonly LOGIN PASSWORD 'a strong password';
GRANT pg_read_all_data TO readonly;
```

On older versions, grant per schema:

```sql
GRANT CONNECT ON DATABASE myapp TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;
```

**What you'll see**

- `list_tables`: tables in `public` by name, and tables in other schemas as `schema.table`, e.g. `reporting.monthly`.
- `describe_table`: accepts `table` or `schema.table`.
- `get_table_indexes`, `get_foreign_keys`: both supported.
- `run_query`: `SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `VALUES` and `TABLE`.
- Dates and timestamps come back exactly as stored, never shifted by time zone.

**Example**

```json
{ "tool": "run_query", "arguments": { "query": "SELECT date_trunc('day', created_at) AS day, count(*) FROM signups GROUP BY 1 ORDER BY 1 DESC LIMIT 7" } }
```

**Worth knowing**

- Every query runs inside a read-only transaction that is always rolled back, which also works through connection poolers like PgBouncer.
- Functions that reach outside the database or change server state are refused: `dblink`, `lo_export`, `pg_terminate_backend`, `set_config`, `pg_sleep` and a few more.
- `SELECT ... INTO` is refused, because it creates a table.

---

## SQLite

**URL**

```text
sqlite:///ABSOLUTE/PATH/TO/file.db
```

Three slashes before an absolute path. A relative path (`sqlite://data/app.db`) is resolved from the folder the server starts in, which is easy to get wrong, so prefer absolute paths.

**Read-only account**

Not needed: the file is always opened read-only. Make sure the server can read the file.

**What you'll see**

- `list_tables`: tables and views.
- `describe_table`, `get_table_indexes`, `get_foreign_keys`: all supported.
- `run_query`: `SELECT`, `WITH`, `EXPLAIN` and `VALUES`. Read a pragma through its function form, e.g. `SELECT * FROM pragma_table_info('notes')`.
- `use_database` does not apply: the file is the database. Connect to a different file instead.

**Example**

```json
{ "tool": "run_query", "arguments": { "query": "SELECT title, created_at FROM notes ORDER BY created_at DESC LIMIT 10" } }
```

**Worth knowing**

- Queries run in a separate process, so one that runs past the timeout is stopped without freezing anything.
- In Docker, mount the folder holding the file: `-v /Users/me/data:/data:ro`, then use `sqlite:///data/app.db`.

---

## SQL Server and Azure SQL

**URL**

```text
mssql://USER:PASSWORD@HOST:1433/DATABASE
sqlserver://USER:PASSWORD@HOST:1433/DATABASE
```

| Option | Meaning |
| --- | --- |
| `?trustServerCertificate=true` | Accept a self-signed certificate (local and development servers) |
| `?encrypt=false` | Turn off encryption (only for very old servers) |
| `?applicationIntent=ReadOnly` | Route to a readable secondary in an availability group |

Connections are encrypted by default.

**Read-only account**

```sql
CREATE LOGIN readonly WITH PASSWORD = 'a Strong password 1';
USE Sales;
CREATE USER readonly FOR LOGIN readonly;
ALTER ROLE db_datareader ADD MEMBER readonly;
```

**What you'll see**

- `list_tables`: tables in `dbo` by name, others as `schema.table`.
- `describe_table`, `get_table_indexes`, `get_foreign_keys`: all supported.
- `run_query`: `SELECT` and `WITH`. Use `TOP (10)` rather than `LIMIT 10`.

**Example**

```json
{ "tool": "run_query", "arguments": { "query": "SELECT TOP (5) CustomerName, SUM(Total) AS total FROM Orders GROUP BY CustomerName ORDER BY total DESC" } }
```

**Worth knowing**

- SQL Server lets statements follow each other without a semicolon, so every query is checked for write keywords anywhere in it. A column named like one (`set`, `open`) must be bracketed: `[set]`.
- Every query runs inside a transaction that is always rolled back.
- `SELECT ... INTO`, `OPENROWSET` and `OPENQUERY` are refused.

---

## ClickHouse

Connects over the HTTP interface, which is what ClickHouse Cloud and most hosted services expose.

**URL**

```text
clickhouse://USER:PASSWORD@HOST:8123/DATABASE
clickhouse+https://USER:PASSWORD@HOST:8443/DATABASE
```

The database defaults to `default`.

**Read-only account**

```sql
CREATE USER reader IDENTIFIED BY 'a strong password' SETTINGS readonly = 1;
GRANT SELECT ON analytics.* TO reader;
GRANT SELECT ON system.data_skipping_indices TO reader;
```

The last grant lets `get_table_indexes` show skipping indices; everything else works without it.

**What you'll see**

- `describe_table`: columns and types.
- `get_table_indexes`: the partition, sorting, primary and sampling keys, plus any data-skipping indices.
- `get_foreign_keys`: not applicable; ClickHouse has none.
- `run_query`: `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC`, `EXPLAIN` and `EXISTS`.

**Example**

```json
{ "tool": "run_query", "arguments": { "query": "SELECT toStartOfHour(ts) AS hour, count() FROM events WHERE ts > now() - INTERVAL 1 DAY GROUP BY hour ORDER BY hour" } }
```

**Worth knowing**

- Table functions that reach outside the server are refused: `url()`, `file()`, `s3()`, `remote()`, `mysql()`, `executable()` and similar.
- For an account that is not already read-only, the server asks ClickHouse to run every query in read-only mode, with a time limit and a cap on result size.

---

## MongoDB

**URL**

```text
mongodb://USER:PASSWORD@HOST:27017/DATABASE?authSource=admin
mongodb://USER:PASSWORD@host1:27017,host2:27017/DATABASE?replicaSet=rs0
mongodb+srv://USER:PASSWORD@cluster0.abcde.mongodb.net/DATABASE
```

Any MongoDB connection option can go in the query string. `authSource=admin` is needed when the user was created in the `admin` database, which is the usual case.

**Read-only account**

```js
use admin
db.createUser({ user: "reader", pwd: "a strong password", roles: [{ role: "read", db: "myapp" }] })
```

**What you'll see**

- `list_tables`: the collections.
- `describe_table`: the fields found in a sample of 100 documents, each with its types and how often it appears, plus the collection's JSON Schema validator if it has one.
- `get_table_indexes`: the indexes.
- `get_table_sample`: a few real documents.

**Query tools**

| Tool | For |
| --- | --- |
| `find_documents` | Find documents with a filter, projection, sort and limit |
| `aggregate` | Run an aggregation pipeline |
| `count_documents` | Count documents matching a filter |
| `distinct_values` | List the different values of a field |

Filters use MongoDB's Extended JSON, so ids and dates work: `{"_id": {"$oid": "64f..."}}`, `{"createdAt": {"$gt": {"$date": "2026-09-01T00:00:00Z"}}}`.

**Examples**

```json
{ "tool": "find_documents", "arguments": { "collection": "orders", "filter": { "total": { "$gt": 100 } }, "sort": { "createdAt": -1 }, "limit": 5 } }
{ "tool": "aggregate", "arguments": { "collection": "users", "pipeline": [{ "$group": { "_id": "$country", "n": { "$sum": 1 } } }, { "$sort": { "n": -1 } }] } }
{ "tool": "count_documents", "arguments": { "collection": "users", "filter": { "active": true } } }
{ "tool": "distinct_values", "arguments": { "collection": "orders", "field": "status" } }
```

**Worth knowing**

- `$out` and `$merge` are refused anywhere in a pipeline, and so are `$where`, `$function` and `$accumulator`.
- MongoDB has no read-only session, so the `read` role is your server-side protection.

---

## Redis, Valkey and KeyDB

**URL**

```text
redis://HOST:6379/0
redis://:PASSWORD@HOST:6379/0
redis://USER:PASSWORD@HOST:6379/0
rediss://USER:PASSWORD@HOST:6380/0
```

The number at the end is the database (0 by default). `rediss://` uses TLS.

**Read-only account** (Redis 6 and newer)

```text
ACL SETUSER reader on >a-strong-password ~* &* -@all +@read +ping +info +command|info
```

`+command|info` matters: before running a command for the assistant, the server asks Redis itself whether that command is read-only, and refuses it if it cannot ask.

**What you'll see**

- `list_databases`: the numbered databases that hold keys.
- `list_tables`: keys, found with `SCAN`, never `KEYS`. Give a pattern for large instances: `session:*`. At most 1000 are listed.
- `describe_table`: a key's type, time to live, length, encoding and memory use.
- `get_table_sample`: the start of the value, read the right way for its type (a string, hash fields, list items, set members, scored members, stream entries or a JSON document).

**Query tool: `redis_command`**

Read commands only, such as `GET`, `MGET`, `HGET`, `HGETALL`, `LRANGE`, `SMEMBERS`, `ZRANGE`, `XRANGE`, `SCAN`, `TYPE`, `TTL`, `INFO` and the RedisJSON, RediSearch and RedisTimeSeries read commands.

```json
{ "tool": "redis_command", "arguments": { "command": "HGETALL", "args": ["user:42"] } }
{ "tool": "redis_command", "arguments": { "command": "ZRANGE", "args": ["leaderboard", "0", "9", "WITHSCORES"] } }
```

**Worth knowing**

- `KEYS` is refused because it freezes a large server; use `list_tables` with a pattern or `SCAN`.
- `CONFIG GET` is refused because it can reveal the password.

---

## Elasticsearch and OpenSearch

**URL**

```text
elasticsearch://USER:PASSWORD@HOST:9200
elasticsearch+https://USER:PASSWORD@HOST:9200
opensearch://USER:PASSWORD@HOST:9200
opensearch+https://USER:PASSWORD@HOST:9200
elasticsearch+https://HOST:9200?api_key=BASE64_API_KEY
```

There is no database part. `?api_key=` authenticates with an API key, which is never shown or logged.

**Read-only account** (Elasticsearch)

```json
PUT _security/role/mcp_reader
{ "cluster": ["monitor"], "indices": [{ "names": ["*"], "privileges": ["read", "view_index_metadata", "monitor"] }] }
```

Then create a user with that role, or an API key limited to it. On OpenSearch, the built-in `readall` role plus `cluster_monitor` does the same.

**What you'll see**

- `list_tables`: the indices, without hidden `.` ones unless your pattern starts with a dot.
- `describe_table`: the index mapping.
- `get_table_sample`: a few documents.
- `list_databases`, `use_database`: not applicable.

**Query tool: `search`**

Takes an index (or pattern, like `logs-*`) and a normal search body.

```json
{ "tool": "search", "arguments": { "index": "logs-*", "body": { "query": { "match": { "level": "error" } }, "sort": [{ "@timestamp": "desc" }], "size": 10 } } }
{ "tool": "search", "arguments": { "index": "orders", "body": { "size": 0, "track_total_hits": true } } }
{ "tool": "search", "arguments": { "index": "orders", "body": { "size": 0, "aggs": { "by_status": { "terms": { "field": "status" } } } } } }
```

The second example is a count; the third groups by a field.

**Worth knowing**

- At most 100 hits per search.
- `scroll` and `pit` are refused, because they leave state behind on the server.
