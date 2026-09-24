# Privacy Policy

Last updated: 25 September 2026

This policy covers `mcp-db-read-only`, distributed as the npm package `@shibbirweb/mcp-db-read-only` and the Docker image `shibbirweb/mcp-db-read-only`.

The short version: the server runs on your machine, talks to the databases you point it at, and to nothing else. It listens on no network port unless you turn on the optional live log viewer. It collects nothing and sends nothing anywhere. It stores nothing after it exits, unless you turn on the optional call log and point it at a file, in which case it writes exactly what that log records to the file you chose.

## What the server sends, and where

Only to the database servers named by your configuration or by the `connect` tool, reached over your own network. For SQLite, nothing leaves the machine at all: the file is read in place.

There is no telemetry, no analytics, no crash reporting, no update check, and no licence check. The author receives no data about you, your databases, your queries or your usage, and has no way to. The runtime dependencies are the MCP SDK, a validation library, and the official or de facto standard driver for each engine (mysql2, pg, mssql, @clickhouse/client, mongodb, ioredis). Elasticsearch and OpenSearch are reached with Node's built-in `fetch`, and SQLite with Node's built-in `node:sqlite`.

## What leaves your machine through the assistant

This is the part worth reading twice, because it is inherent to what an MCP server is.

When your AI assistant calls a tool, the result goes back to the assistant. If that assistant is a hosted model, **rows, documents, keys and search hits returned by a query are sent to the model provider along with the rest of your conversation**, under their privacy policy, not this one. Table names, column names, sample rows and query results are all conversation content once returned.

This server cannot prevent that, and neither can any other MCP server. What you can do:

- Connect with accounts whose permissions reach only the data you are willing to share.
- Treat tables, collections and keys holding personal data, credentials or payment details as off limits unless you specifically intend to expose them.
- Remember that `get_table_sample` returns real data, not synthetic data, and that `describe_table` on MongoDB reads a sample of real documents to infer their shape.

The read-only guarantee protects your data from being *changed*. It does not stop it from being *read*, which is the entire point of the tool.

## Tool descriptions

An MCP server tells your assistant what its tools do, and the assistant acts on that text. A server can abuse this by describing one thing and doing another, or by hiding instructions in a description to steer the model toward something you did not ask for. The descriptions here are not that.

Every tool's description states what the tool does and stops there. None of them contains instructions to the assistant about unrelated actions, hidden or invisible text, or any attempt to influence behaviour beyond choosing the right tool. `run_query` says it runs read-only SQL, and the validator permits only read statements. `aggregate` says `$out` and `$merge` are not allowed, and they are refused. `redis_command` says write commands are refused, and they are. `connect` says credentials are not persisted to disk, and they are not: the optional call log, the only thing that can write to disk, redacts them before writing.

The declared capability hints match the enforced behaviour, and all four are stated on every tool. The fifteen reading tools declare `readOnlyHint: true` and cannot write: each engine is guarded by two independent layers, described in the README's Security section. The three connection tools declare `readOnlyHint: false` because they change which server and database the session points at, and `destructiveHint: false` because they alter nothing in any database.

The tool list is fixed at build time. Nothing is fetched at runtime and no description can change after you install a version, so the tools you audit are the tools you run. CI asserts the annotations by reading them off a real handshake against the packaged artifact.

## Credentials

Credentials reach the server in one of two ways: environment variables at startup, or the `connect` tool during a session.

They are held in memory for the life of the process and are never written to disk by this server. Connections are identified and displayed by a string built from the scheme, user, host, port, database and non-secret URL options only. The password, and any URL option that looks like a credential (`api_key`, `token`, `secret`, `password` and similar), are deliberately excluded, so they do not appear in log output or in tool results. Error messages about a malformed URL never repeat the URL.

Two things outside this server's control are worth knowing:

- MCP client configuration files such as `claude_desktop_config.json` and `.mcp.json` store whatever you put in them in plain text on your disk. Keep them out of version control.
- Credentials passed to the `connect` tool travel through your assistant first, which makes them conversation content exactly as described above. Prefer environment variables or `DB_PROFILES` for anything sensitive.

## Logs

By default, diagnostics go to standard error and consist of configuration warnings, the active connection description, and connection errors reported by a driver. No passwords, no query text, no result data.

Standard error is captured by your MCP client, so where those lines end up is determined by that client.

### The optional call log

Off unless you set `DB_LOG=true`, `DB_LOG_FILE` or `DB_LOG_DIR`. When it is on, the server logs every tool call: its arguments, every statement it sent to a database (queries, commands, request lines and their parameters), and the **complete output returned to the assistant, including every row, document and key read**. With `DB_LOG=true` that goes to standard error; with `DB_LOG_FILE` it is appended to the file you named; with `DB_LOG_DIR` every entry is saved as its own JSON file in the folder you named. Files and folders are created readable by your user only, and the server never deletes, rotates or uploads them.

Two things hold even with logging on:

- **Credentials are never logged.** Password arguments, passwords inside connection URLs, and URL options that look like credentials (`api_key`, `token` and similar) are replaced with `***` before anything is written, and there is no setting to change that.
- **The log goes only where you point it.** It is never sent anywhere by this server.

A log file therefore holds the same data your assistant saw. Protect, rotate and delete it as you would that data. The server never deletes or rotates it for you.

### The live viewer

If you also set `DB_LOG_PORT`, the server listens on that port, on every network interface, and serves a page showing the call log live: the saved folder when `DB_LOG_DIR` is set, including calls made by other copies of the server saving there, or otherwise the recent history kept in memory. **It has no access control.** Anyone who can reach the port can read every logged query and result, and the server says so when the viewer starts. Nothing is served beyond the call log itself, the page loads nothing from any other server, and without `DB_LOG_PORT` the server listens on no port at all.

## Retention

Nothing is persisted by default. The active connection, session profiles created with `connect`, and every open driver connection live in process memory and cease to exist when the process exits. The server keeps no database, cache, history or state file of its own. The SQLite helper process it starts exits with it.

The one exception is the optional call log, if you point it at a file or folder: it is yours, it persists until you delete it, and it contains what the section above describes.

## Third parties

At runtime, none.

Installing the software involves the distribution channel you chose, npm or Docker Hub, and those providers see the request under their own policies. The source is hosted on GitHub. None of these are contacted while the server is running.

## Changes

This policy is versioned in the repository, so its history is public. Material changes will accompany a release rather than arriving silently.

## Contact

Questions or corrections: https://github.com/shibbirweb/mcp-db-read-only/issues
