# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each release is published to npm and Docker Hub from the same tag. Where a version reaches one channel but not the other, the entry says so.

## [Unreleased]

## [1.1.0]

Not yet published to npm, Docker Hub or the MCP Registry.

### Added

- The log viewer's footer links to the GitHub repository, to star it, and to its issues page, to request a feature or report a problem. The links open in a new tab and send no referrer; the page still loads nothing from outside the viewer.

## [1.0.0]

First stable release. Not yet published to npm, Docker Hub or the MCP Registry.

### Added

- `mcp-db-read-only viewer --dir <folder> --port <port>`: the live log viewer as its own process, reading a `DB_LOG_DIR` folder, with no MCP server or database. Run it in a terminal so the servers an MCP client starts only write logs and never hold a port. It exits with a clear error when the port is taken.

## [0.2.0]

Not yet published to npm, Docker Hub or the MCP Registry.

### Added

- Optional call logging (`DB_LOG`, `DB_LOG_FILE`, `DB_LOG_FORMAT`): every tool call with its input, each statement sent to the database, and the full output, in a readable boxed format or as JSON lines. Credentials are always redacted, and a logging failure never fails a call.
- A permanent log folder (`DB_LOG_DIR`): every entry saved as its own pretty JSON file, in a folder per day, never deleted, shared safely by every copy of the server.
- A live log viewer in the browser (`DB_LOG_PORT`, `DB_LOG_HISTORY`): paginated, 20 per page by default with 10, 20, 30 or 50 to choose from; filters across everything logged; a copy icon on every block; and live updates as each call finishes. With a log folder it shows every copy's calls, across restarts. Off unless a port is set; it has no access control and listens on all interfaces.
- The viewer binds its port on the first tool call, so the copy of the server actually in use gets it. A busy port is explained once in the chat, naming the process holding it, and retried on every call.
- `current_connection` reports the viewer's state.

## [0.1.0]

First version. Never published to npm, Docker Hub or the MCP Registry.

### Added

- Read-only access to MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, ClickHouse, MongoDB, Redis, Elasticsearch and OpenSearch from one server, with the connection, database and engine switchable mid-conversation.
- Connections configured as URLs, through `DB_URL`, `DB_PROFILES` or the `connect` tool, with the password optionally given separately.
- The configuration of `mcp-mysql-read-only` (`MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PROFILES` and the rest) is read unchanged, so the image or package can be swapped in place.
- Browse tools that work on every engine: `list_tables` (with a glob `pattern`), `describe_table`, `get_table_indexes`, `get_foreign_keys`, `get_table_sample`.
- Query tools per engine family: `run_query` for SQL, `find_documents`, `aggregate`, `count_documents` and `distinct_values` for MongoDB, `search` for Elasticsearch and OpenSearch, `redis_command` for Redis.
- Two independent read-only layers on every engine, each proved by integration tests that send writes straight to the driver.
- A dialect-aware SQL validator that lexes PostgreSQL dollar quotes and `E''` strings, SQL Server brackets and ClickHouse heredocs, scans every T-SQL statement for writes, and refuses constructs it cannot read with certainty, such as nested comments and MySQL executable comments.
- SQLite runs in a separate process, so a query past the timeout is killed rather than freezing the server.
