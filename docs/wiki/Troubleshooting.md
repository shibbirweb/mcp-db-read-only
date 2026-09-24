# Troubleshooting

## The server doesn't show up in my client

- **Restart the client completely.** Clients load MCP servers only when they start. In Claude Desktop, quit with Cmd+Q (Mac) rather than closing the window.
- **Check the config is valid JSON.** A missing comma or quote stops every server loading. Paste it into any JSON validator.
- **Look at the client's log.** Claude Desktop keeps one per server: `~/Library/Logs/Claude/mcp-server-<name>.log` on a Mac. The server writes a line there when it starts, and a warning for any setting it couldn't read.

## "npx" fails, or complains about node:sqlite

The server needs **Node.js 22.13 or newer**. Check with `node --version`. If your client picks up an older Node, give the full path to a newer one as the `command`, or use [Docker](Docker).

## Can't connect

- **From Docker to a database on your computer:** use `host.docker.internal`, not `localhost`, and keep `--add-host host.docker.internal:host-gateway`.
- **Wrong port or host:** the error names what it tried; compare it with your URL.
- **Password with special characters:** `@`, `/`, `#`, `:` or `?` in a password break the URL. Put the password in `DB_PASSWORD` (or `{"url": ..., "password": ...}` in `DB_PROFILES`) instead.
- **SQL Server "certificate" errors:** add `?trustServerCertificate=true` for a local or development server.
- **MongoDB "Authentication failed":** add `?authSource=admin` if the user was created in the `admin` database.

A failed connection never replaces a working one: the previous connection stays active.

## "No active connection"

Nothing is configured yet. Set `DB_URL` or `DB_PROFILES`, or just ask the assistant to connect: *"connect to mysql://readonly@localhost/shop"*.

## "No database selected"

The URL has no database name at the end. Add one (`.../shop`), or ask *"list the databases"* and then *"use the shop database"*.

## A query was refused

That's the read-only protection at work, and the message says why. Common cases:

| Message mentions | Why | What to do |
| --- | --- | --- |
| "Only SELECT, WITH ..." | It wasn't a read | Ask for a read instead |
| "Multiple statements" | Two statements in one query | Run them one at a time |
| "quote it as" | A column named like a SQL keyword | Quote the column: `` `update` ``, `"update"` or `[update]` |
| "nested block comment" / "executable comment" | Comments the checker can't read with certainty | Remove the comment |
| "is not allowed: ..." | A function that could reach outside the database | Rewrite without it |
| "KEYS blocks the server" (Redis) | `KEYS` freezes large servers | Use `SCAN`, or list keys with a pattern |

## Redis: "Could not confirm ... is read-only"

Before running a command, the server asks Redis whether it is read-only, using `COMMAND INFO`. If your Redis account can't run that, commands are refused. Add it to the account: `ACL SETUSER reader +command|info`.

## ClickHouse: get_table_indexes says "Not enough privileges"

Grant access to the skipping-index list: `GRANT SELECT ON system.data_skipping_indices TO reader`.

## Logging

- **No log files appear:** check `DB_LOG_DIR` is set on the server (not on the viewer), restart the client, and make a call. The folder is created on the first call.
- **The viewer page is empty:** make sure `--dir` points at the same folder as `DB_LOG_DIR`.
- **"port ... is used by":** another program has that port. Stop it, or use `--port 4801`.
- **The page can't be opened from another device:** the viewer listens on all interfaces by default, so check a firewall isn't blocking the port. (And remember it has no password.)

## Still stuck?

Open an issue with the error message and the relevant lines of the client's log (remove anything private first): https://github.com/shibbirweb/mcp-db-read-only/issues
