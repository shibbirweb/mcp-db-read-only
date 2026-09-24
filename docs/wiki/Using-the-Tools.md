# Using the Tools

You don't call these tools yourself: you ask the assistant in plain words and it picks the right one. This page shows what each tool does, so you know what to ask for, and what the assistant sends when it uses one.

There are 18 tools in three groups.

---

## Connecting and switching

| Tool | Ask something like | What happens |
| --- | --- | --- |
| `current_connection` | "Which database are you connected to?" | Shows the active connection, its engine, and the live viewer's status if one is configured |
| `list_connections` | "What connections do you have?" | Lists the named databases from `DB_PROFILES`, plus any opened during the chat |
| `list_databases` | "What databases are on this server?" | Lists databases (schemas on MySQL, numbered databases on Redis) |
| `use_database` | "Switch to the analytics database." | Moves to another database on the same server |
| `use_connection` | "Switch to staging." | Moves to another named connection, on any engine |
| `connect` | "Connect to postgres://readonly@10.0.0.5/reports." | Opens any database from a URL and remembers it for the rest of the chat |

Every switch is **checked before it takes effect**. If the database doesn't exist or the server can't be reached, you get an error and the previous connection keeps working.

Nothing needs a restart. A connection opened with `connect` is forgotten when the client closes; put it in `DB_PROFILES` to keep it.

```json
{ "tool": "connect", "arguments": { "url": "postgres://readonly@db.example.com/reports", "password": "secret", "alias": "reports" } }
{ "tool": "use_connection", "arguments": { "profile": "reports", "database": "reports_2025" } }
```

---

## Browsing, on every database

These work the same way on every engine, each in its own terms.

| Tool | What it shows | SQL databases | MongoDB | Redis | Elasticsearch |
| --- | --- | --- | --- | --- | --- |
| `list_tables` | What's there | Tables and views | Collections | Keys | Indices |
| `describe_table` | The structure of one | Columns and types | Fields found in sample documents | Type, TTL, size | Mapping |
| `get_table_indexes` | Its indexes | Yes | Yes | No | No |
| `get_foreign_keys` | Its relationships | Yes (not ClickHouse) | No | No | No |
| `get_table_sample` | A few real rows | Rows | Documents | The start of the value | Hits |

`list_tables` takes an optional **pattern**, with `*` for anything and `?` for one character: `user*`, `logs-2026-*`, `session:*`.

```json
{ "tool": "list_tables", "arguments": { "pattern": "order*" } }
{ "tool": "describe_table", "arguments": { "table": "reporting.monthly" } }
{ "tool": "get_table_sample", "arguments": { "table": "orders", "limit": 5 } }
```

**Reading another database for one question.** Every browsing and query tool takes an optional `database`, used for that call only, so the assistant can compare two databases without switching back and forth:

```json
{ "tool": "list_tables", "arguments": { "database": "archive" } }
```

---

## Querying, per kind of database

| Tool | Database | What it takes |
| --- | --- | --- |
| `run_query` | MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, ClickHouse | One read-only SQL statement |
| `find_documents` | MongoDB | A filter, and optionally a projection, sort, limit (up to 100) and skip |
| `aggregate` | MongoDB | An aggregation pipeline, without `$out` or `$merge` |
| `count_documents` | MongoDB | A filter |
| `distinct_values` | MongoDB | A field name, and optionally a filter |
| `search` | Elasticsearch, OpenSearch | An index or pattern, and a search body (up to 100 hits) |
| `redis_command` | Redis | One read-only command and its arguments |

```json
{ "tool": "run_query", "arguments": { "query": "SELECT country, COUNT(*) AS n FROM customers GROUP BY country ORDER BY n DESC" } }
{ "tool": "find_documents", "arguments": { "collection": "orders", "filter": { "status": "shipped" }, "limit": 10 } }
{ "tool": "search", "arguments": { "index": "logs-*", "body": { "query": { "match": { "level": "error" } } } } }
{ "tool": "redis_command", "arguments": { "command": "GET", "args": ["feature:flags"] } }
```

Examples for each database are on the [Databases](Databases) page.

### What "read-only" allows

- **SQL**: `SELECT` and `WITH` everywhere, plus the database's own read statements: `SHOW`, `DESCRIBE` and `EXPLAIN` where they exist. One statement at a time.
- **MongoDB**: any read, but no `$out`, `$merge`, `$where`, `$function` or `$accumulator`.
- **Redis**: an allowlist of read commands. `KEYS` and `CONFIG` are refused.
- **Elasticsearch**: searches, counts and aggregations; no `scroll` or point-in-time.

If a query is refused, the message says why, and the assistant usually rewrites it.

### Big results

At most 100 rows (or documents, or values) are returned to the assistant, with a note saying how many there were in total. Ask for fewer, or add a `LIMIT`, for large tables.

### If the assistant uses the wrong tool

Calling, say, `run_query` while connected to MongoDB returns a message naming the MongoDB tools to use instead. The assistant picks up on that without you doing anything.
