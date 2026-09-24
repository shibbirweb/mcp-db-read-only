<!--
  This file is the Docker Hub description, published by
  .github/workflows/dockerhub-description.yml via `readme-filepath`.

  Docker Hub does not resolve relative links, so every link here is absolute.
  Keep it in sync with README.md: the same content, plus the tags list below.
-->

# mcp-db-read-only

[![CI](https://github.com/shibbirweb/mcp-db-read-only/actions/workflows/ci.yml/badge.svg)](https://github.com/shibbirweb/mcp-db-read-only/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40shibbirweb%2Fmcp-db-read-only?label=npm&color=cb3837)](https://www.npmjs.com/package/@shibbirweb/mcp-db-read-only)
[![Docker Hub](https://img.shields.io/docker/v/shibbirweb/mcp-db-read-only?label=docker%20hub&sort=semver)](https://hub.docker.com/r/shibbirweb/mcp-db-read-only)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/shibbirweb/mcp-db-read-only/blob/master/LICENSE)

Let your AI assistant **look at your databases without being able to change them.**

Point it at MySQL, PostgreSQL, SQLite, SQL Server, ClickHouse, MongoDB, Redis or Elasticsearch, then just ask questions in plain words: *"how many users signed up this week?"*, *"what's in the orders table?"*, *"which Redis keys hold sessions?"*. It can read anything you give it access to, and it cannot write, update or delete anything.

- **Every popular database, one server.** Switch between them in the middle of a conversation.
- **Read-only, twice over.** Every query is checked before it is sent, and the database itself is also told to refuse writes.
- **No restart to switch.** Change database, server or engine by asking.
- **Optional logging**, with a live page in your browser that shows every query as it happens.

```text
You  --ask in plain words-->  Your AI assistant  --tool call-->  mcp-db-read-only  --read-only query-->  Your databases
                                                                  mcp-db-read-only  <--rows, documents, keys--
```

Works with Claude Desktop, Claude Code, and any other [MCP](https://modelcontextprotocol.io) client.

**Source and full documentation: [github.com/shibbirweb/mcp-db-read-only](https://github.com/shibbirweb/mcp-db-read-only)**

## Supported tags

`1.0.0`, `1.0`, `1`, `latest`, built for `linux/amd64` and `linux/arm64`.

---

## Quick start

**1. Have Node.js 22.13 or newer** (`node --version`), or Docker.

**2. Add the server to your client.** For Claude Desktop, edit `claude_desktop_config.json` (Settings, Developer, Edit Config). For Claude Code, create `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "databases": {
      "command": "npx",
      "args": ["-y", "@shibbirweb/mcp-db-read-only"],
      "env": {
        "DB_URL": "postgres://readonly:secret@localhost:5432/myapp"
      }
    }
  }
}
```

Replace the `DB_URL` with your own database. The examples below show one for every kind.

**3. Restart the client once, and ask away:**

> "What tables are in my database?"
> "Show me the 5 newest orders."
> "How many customers are in each country?"

That's it. You never need to restart again to change database; just ask the assistant to switch.

---

## Examples for each database

Each database has a URL **format**, then a real **example** to copy and change. Put the finished URL in `DB_URL`.

Replace each `[PLACEHOLDER]` with your own value:

| Placeholder | What to put there |
| --- | --- |
| `[USER]` | The database user name |
| `[PASSWORD]` | That user's password |
| `[HOST]` | The server's address, e.g. `localhost` or `db.example.com` |
| `[PORT]` | The server's port. Optional: leave out `:[PORT]` to use the usual one shown for each database |
| `[DATABASE]` | The database name. Optional for most: leave it out and ask the assistant to list them |

No password? Leave out `:[PASSWORD]`. No user either? Leave out `[USER]:[PASSWORD]@` entirely.

### MySQL and MariaDB

Format (usual port 3306):

```text
mysql://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
mariadb://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
```

Example:

```text
mysql://readonly:secret@localhost:3306/shop
```

> "List the tables in shop." · "Describe the orders table." · "What were last month's top 10 products by revenue?"

### PostgreSQL

Format (usual port 5432). Add `?sslmode=require` to use TLS:

```text
postgres://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
```

Example:

```text
postgres://readonly:secret@localhost:5432/myapp
```

> "Which tables are in the reporting schema?" · "Show the foreign keys on invoices." · "Count signups per day this week."

### SQLite

Format (three slashes, then the full path to the file):

```text
sqlite:///[PATH_TO_FILE]
```

Example:

```text
sqlite:///Users/me/data/app.db
```

The file is opened read-only.

> "What tables does this file have?" · "Show 10 rows from notes."

### SQL Server (and Azure SQL)

Format (usual port 1433). Add `?trustServerCertificate=true` for a local server with a self-signed certificate:

```text
mssql://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
```

Example:

```text
mssql://readonly:secret@localhost:1433/Sales?trustServerCertificate=true
```

> "List the tables in Sales." · "Show the top 5 customers by order total." (SQL Server uses `TOP 5`, not `LIMIT`; the assistant knows.)

### ClickHouse

Format (usual port 8123, or 8443 with `clickhouse+https`):

```text
clickhouse://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
clickhouse+https://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]
```

Example:

```text
clickhouse://reader:secret@localhost:8123/analytics
```

> "How many events per hour did we have yesterday?" · "What is the sorting key of the events table?"

### MongoDB

Format (usual port 27017). Use `mongodb+srv` for MongoDB Atlas, with no port:

```text
mongodb://[USER]:[PASSWORD]@[HOST]:[PORT]/[DATABASE]?authSource=admin
mongodb+srv://[USER]:[PASSWORD]@[CLUSTER_HOST]/[DATABASE]
```

Example:

```text
mongodb://reader:secret@localhost:27017/myapp?authSource=admin
```

> "What collections are in myapp?" · "What fields do documents in users have?" · "Find the 5 most recent orders over 100." · "Count users by country."

### Redis (and Valkey, KeyDB)

Format (usual port 6379). `[DB_NUMBER]` is the database number, 0 if left out; `rediss` means TLS:

```text
redis://[USER]:[PASSWORD]@[HOST]:[PORT]/[DB_NUMBER]
rediss://[USER]:[PASSWORD]@[HOST]:[PORT]/[DB_NUMBER]
```

Example:

```text
redis://localhost:6379/0
```

> "Which keys start with session:?" · "What's inside user:42?" · "How long until cache:home expires?"

### Elasticsearch and OpenSearch

Format (usual port 9200, no database). Add `+https` for TLS, or `?api_key=[API_KEY]` instead of a user and password:

```text
elasticsearch://[USER]:[PASSWORD]@[HOST]:[PORT]
opensearch://[USER]:[PASSWORD]@[HOST]:[PORT]
```

Example:

```text
elasticsearch+https://elastic:secret@search.example.com:9200
```

> "What indices do we have?" · "Find error logs from the last hour." · "How many documents are in logs-2026.09?"

Detailed notes for every database, including how to create a read-only account, are in the [Databases guide](https://github.com/shibbirweb/mcp-db-read-only/wiki/Databases).

---

## Using several databases

Give each one a name with `DB_PROFILES`, and switch by asking ("switch to legacy", "use the cache"):

```json
"env": {
  "DB_PROFILES": "{\"app\": \"postgres://readonly@localhost/app\", \"legacy\": \"mysql://readonly@localhost/shop\", \"cache\": \"redis://localhost:6379/0\"}",
  "DB_DEFAULT_PROFILE": "app"
}
```

You can also connect to a database you didn't list, mid-conversation: *"connect to postgres://readonly@10.0.0.5/reports"*.

**Password with special characters** (`@`, `/`, `#`)? Give it separately instead of inside the URL: `DB_PASSWORD` next to `DB_URL`, or `{"url": "...", "password": "..."}` inside `DB_PROFILES`.

---

## Running with Docker

Nothing to install but Docker:

```json
{
  "mcpServers": {
    "databases": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--add-host", "host.docker.internal:host-gateway",
        "-e", "DB_URL=postgres://readonly:secret@host.docker.internal:5432/myapp",
        "shibbirweb/mcp-db-read-only"
      ]
    }
  }
}
```

Inside Docker, use `host.docker.internal` instead of `localhost` to reach a database on your own computer. For SQLite, mount the folder: add `"-v", "/Users/me/data:/data:ro"` and use `sqlite:///data/app.db`.

---

## Watching what the assistant does

Turn on logging to keep a record of every query the assistant runs, and see them live in your browser.

```text
The assistant writes a query
             |
             v
1. Checked by this server: only a read?
     no  -->  Refused, with the reason
     yes -->  2. Sent to the database in read-only mode
                   a read                         -->  The answer
                   a write that slipped through   -->  Refused by the database
```

**1. Save logs to a folder** by adding this to the server's `env`:

```json
"DB_LOG_DIR": "/Users/me/Library/Logs/mcp-db-read-only"
```

Each query is saved as its own file, one folder per day. Nothing is ever deleted automatically.

**2. Open the viewer** in a terminal, whenever you want to watch:

```bash
npx -y @shibbirweb/mcp-db-read-only viewer --dir /Users/me/Library/Logs/mcp-db-read-only --port 4800
```

Then open **http://127.0.0.1:4800/**. You'll see every call: what was asked, the exact query sent, how long it took, and the result. It updates live, shows 20 per page (10, 20, 30 or 50 to choose from), and lets you filter and copy anything. Press Ctrl+C to close it.

> The viewer has no password. Anyone who can reach that port on your network can read the log while it runs.

Passwords are never written to the logs. More in the [Logging guide](https://github.com/shibbirweb/mcp-db-read-only/wiki/Logging-and-Viewer).

---

## Is it really read-only?

Yes, in two independent ways, so a mistake in one is caught by the other:

```text
mcp-db-read-only  --one file per call-->  Log folder (DB_LOG_DIR)  -->  viewer command  --live-->  Your browser
(in your AI client)                                                     (in a terminal)
```

1. **Before anything is sent**, every query is checked. Only reads are allowed: `SELECT` and friends for SQL, read commands for Redis, searches for Elasticsearch, and no `$out` or `$merge` for MongoDB.
2. **The database is told to refuse writes too**, wherever it supports that: read-only sessions on MySQL, read-only transactions on PostgreSQL, a read-only file on SQLite, and so on.

**The best protection is still a read-only database account.** Then nothing can write through it, whatever happens. The [Databases guide](https://github.com/shibbirweb/mcp-db-read-only/wiki/Databases) shows how to create one for each database.

Keep in mind that the assistant **can read** whatever the account can see, and what it reads becomes part of your conversation with the AI provider. Only connect accounts that can see data you are happy to share. See [PRIVACY.md](https://github.com/shibbirweb/mcp-db-read-only/blob/master/PRIVACY.md).

---

## Settings

All optional. Set them in the server's `env`.

| Setting | What it does |
| --- | --- |
| `DB_URL` | The database to connect to at startup |
| `DB_PASSWORD` | The password for `DB_URL`, if you'd rather keep it out of the URL |
| `DB_PROFILES` | Several named databases, as JSON, to switch between |
| `DB_DEFAULT_PROFILE` | Which of those to start with |
| `DB_QUERY_TIMEOUT_MS` | Stop a query after this long (default 30000, that is 30 seconds) |
| `DB_CONNECT_TIMEOUT_MS` | Give up connecting after this long (default 10000) |
| `DB_LOG_DIR` | Save every call as a file in this folder |
| `DB_LOG=true` | Write every call to the client's log instead |
| `DB_LOG_FILE` | Write every call to one file instead |
| `DB_LOG_FORMAT` | `pretty` (default) or `json`, for `DB_LOG` and `DB_LOG_FILE` |
| `DB_LOG_PORT` | Run the viewer inside the server itself (the separate `viewer` command is usually better) |

Coming from `mcp-mysql-read-only`? Its `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` and `MYSQL_PROFILES` settings still work as they are.

Full details: [Configuration guide](https://github.com/shibbirweb/mcp-db-read-only/wiki/Configuration).

---

## Troubleshooting

**"Can't connect" from Docker to a database on my computer.** Use `host.docker.internal` instead of `localhost`, and keep the `--add-host` line from the Docker example.

**The server won't start with npx.** Check `node --version` is 22.13 or newer.

**SQL Server says the certificate isn't trusted.** Add `?trustServerCertificate=true` to the URL for a local or development server.

**"No database selected".** Your URL has no database name. Add one (`.../myapp`), or ask the assistant to list the databases and pick one.

**My password has `@` or `#` in it.** Use `DB_PASSWORD`, or the `{"url": ..., "password": ...}` form in `DB_PROFILES`.

**The viewer says the port is in use.** Something else is using it. Close that, or pick another port with `--port 4801`.

More answers in the [Troubleshooting guide](https://github.com/shibbirweb/mcp-db-read-only/wiki/Troubleshooting).

---

## Learn more

- [Wiki](https://github.com/shibbirweb/mcp-db-read-only/wiki): user guides for every feature, plus developer documentation
- [CHANGELOG.md](https://github.com/shibbirweb/mcp-db-read-only/blob/master/CHANGELOG.md): what changed in each version
- [PRIVACY.md](https://github.com/shibbirweb/mcp-db-read-only/blob/master/PRIVACY.md): what the server sends where (nothing, except to your databases)
- Contributing: pull requests to `master` are welcome. `./scripts/test-in-docker.sh` runs the full test suite against every database in throwaway containers; see [Testing](https://github.com/shibbirweb/mcp-db-read-only/wiki/Testing). If you change this README, change [README.dockerhub.md](https://github.com/shibbirweb/mcp-db-read-only/blob/master/README.dockerhub.md) to match.

## License

[MIT](https://github.com/shibbirweb/mcp-db-read-only/blob/master/LICENSE) © Md. Shibbir Ahmed
