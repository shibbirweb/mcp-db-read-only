# Configuration

Everything is set with environment variables, in the `env` block of your MCP client's config (or `-e` flags with Docker). None is required: with nothing set, the server starts and the assistant can still `connect` to a database you give it in the chat.

## Connections

### One database: `DB_URL`

```json
"env": {
  "DB_URL": "mysql://readonly@localhost:3306/shop",
  "DB_PASSWORD": "secret"
}
```

`DB_PASSWORD` is optional. Use it when the password contains characters that are special in a URL (`@`, `/`, `#`, `:`, `?`), so you don't have to percent-encode them.

### Several databases: `DB_PROFILES`

A JSON object of names to connection URLs. The assistant switches between them when you ask ("switch to cache"):

```json
"env": {
  "DB_PROFILES": "{\"app\": \"postgres://readonly@localhost/app\", \"shop\": \"mysql://readonly@localhost/shop\", \"cache\": \"redis://localhost:6379/0\"}",
  "DB_DEFAULT_PROFILE": "app"
}
```

A profile can also be an object, with the password kept separate:

```json
{
  "app": { "url": "postgres://readonly@localhost/app", "password": "p@ss/w#rd" },
  "cache": "redis://localhost:6379/0"
}
```

Because `DB_PROFILES` is JSON inside a JSON string in most client configs, the inner quotes need escaping as `\"`, as above.

**Which one starts active:** `DB_DEFAULT_PROFILE` if it names a profile, otherwise one called `default`, otherwise the first one listed. `DB_URL` on its own becomes a profile called `default`.

A profile that can't be read (a typo in its URL, say) is skipped with a warning in the client's log; the others still load.

### Coming from mcp-mysql-read-only

Its settings still work unchanged, so you can swap the package or image name and keep your config:

| Old setting | Still read |
| --- | --- |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Yes, as the profile `default` |
| `MYSQL_PROFILES` | Yes, in its original object form |
| `MYSQL_DEFAULT_PROFILE`, `MYSQL_QUERY_TIMEOUT_MS`, `MYSQL_CONNECT_TIMEOUT_MS` | Yes, when the `DB_` equivalents are not set |

If a name is defined in both `DB_PROFILES` and `MYSQL_PROFILES`, the `DB_PROFILES` one wins.

## Timeouts

| Setting | Default | Meaning |
| --- | --- | --- |
| `DB_QUERY_TIMEOUT_MS` | `30000` | A query running longer than this is stopped, by the database itself wherever it supports that |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Give up connecting after this long |

## Logging

All off by default. See [Logging and Viewer](Logging-and-Viewer) for what gets logged and how to watch it.

| Setting | Meaning |
| --- | --- |
| `DB_LOG_DIR` | Save every call as its own JSON file in this folder, permanently |
| `DB_LOG=true` | Write every call to the MCP client's own log |
| `DB_LOG_FILE` | Write every call to one file |
| `DB_LOG_FORMAT` | `pretty` (default) or `json`, for `DB_LOG` and `DB_LOG_FILE` |
| `DB_LOG_PORT` | Serve the live viewer from inside the server (the separate `viewer` command is usually better) |
| `DB_LOG_HISTORY` | Without `DB_LOG_DIR`, how many recent calls the in-server viewer keeps in memory (default 500) |

## A complete example

Claude Desktop, three databases, logging to a folder:

```json
{
  "mcpServers": {
    "databases": {
      "command": "npx",
      "args": ["-y", "@shibbirweb/mcp-db-read-only"],
      "env": {
        "DB_PROFILES": "{\"app\": \"postgres://readonly@localhost/app\", \"events\": \"mongodb://reader@localhost/events?authSource=admin\", \"cache\": \"redis://localhost:6379/0\"}",
        "DB_DEFAULT_PROFILE": "app",
        "DB_LOG_DIR": "/Users/me/Library/Logs/mcp-db-read-only"
      }
    }
  }
}
```
