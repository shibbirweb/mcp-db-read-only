# Getting Started

This page takes you from nothing to asking your AI assistant questions about your database, in about five minutes.

## What you need

- An MCP client: **Claude Desktop**, **Claude Code**, or any other client that supports MCP servers.
- Either **Node.js 22.13 or newer** (check with `node --version`) or **Docker**.
- A database, and ideally a **read-only account** for it. The [Databases](Databases) page shows how to create one for each kind.

## Step 1: write your connection URL

The server connects using a URL. It looks like this:

```text
engine://user:password@host:port/database
```

For example:

| Database | Example URL |
| --- | --- |
| MySQL / MariaDB | `mysql://readonly:secret@localhost:3306/shop` |
| PostgreSQL | `postgres://readonly:secret@localhost:5432/myapp` |
| SQLite | `sqlite:///Users/me/data/app.db` |
| SQL Server | `mssql://readonly:secret@localhost:1433/Sales?trustServerCertificate=true` |
| ClickHouse | `clickhouse://reader:secret@localhost:8123/analytics` |
| MongoDB | `mongodb://reader:secret@localhost:27017/myapp?authSource=admin` |
| Redis | `redis://localhost:6379/0` |
| Elasticsearch | `elasticsearch://elastic:secret@localhost:9200` |

Every engine's options are on the [Databases](Databases) page.

> If your password contains `@`, `/`, `#` or `:`, leave it out of the URL and give it separately with `DB_PASSWORD` (see step 2).

## Step 2: add the server to your client

### Claude Desktop

Open **Settings, Developer, Edit Config**. This opens `claude_desktop_config.json`. Add:

```json
{
  "mcpServers": {
    "databases": {
      "command": "npx",
      "args": ["-y", "@shibbirweb/mcp-db-read-only"],
      "env": {
        "DB_URL": "postgres://readonly@localhost:5432/myapp",
        "DB_PASSWORD": "secret"
      }
    }
  }
}
```

If the file already has an `mcpServers` section, add `"databases": {...}` inside it next to the others.

### Claude Code

Create `.mcp.json` in your project folder with the same content as above. Claude Code asks you to approve the server the first time.

### With Docker instead of Node

Replace `command` and `args`:

```json
"command": "docker",
"args": [
  "run", "-i", "--rm",
  "--add-host", "host.docker.internal:host-gateway",
  "-e", "DB_URL=postgres://readonly:secret@host.docker.internal:5432/myapp",
  "shibbirweb/mcp-db-read-only"
]
```

Note `host.docker.internal` instead of `localhost`. See [Docker](Docker) for more.

## Step 3: restart and ask

Quit and reopen your client (in Claude Desktop, Cmd+Q on a Mac, not just closing the window). Then try:

> "What tables are in my database?"
> "Describe the users table."
> "Show me 5 rows from orders."
> "How many orders were placed per day last week?"

The assistant picks the right tool, runs it, and answers. You can watch every query it runs with the [log viewer](Logging-and-Viewer).

## Next steps

- **More than one database?** See [Configuration](Configuration) for `DB_PROFILES`.
- **What can the assistant do?** See [Using the Tools](Using-the-Tools).
- **Something not working?** See [Troubleshooting](Troubleshooting).
