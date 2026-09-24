# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

Each release is published to npm and Docker Hub from the same tag. Where a version reaches one channel but not the other, the entry says so.

## [Unreleased]

## [0.1.0]

First release. Not yet published to npm, Docker Hub or the MCP Registry.

### Added

- Read-only access to MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, ClickHouse, MongoDB, Redis, Elasticsearch and OpenSearch from one server, with the connection, database and engine switchable mid-conversation.
- Connections configured as URLs, through `DB_URL`, `DB_PROFILES` or the `connect` tool, with the password optionally given separately.
- The configuration of `mcp-mysql-read-only` (`MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PROFILES` and the rest) is read unchanged, so the image or package can be swapped in place.
- Browse tools that work on every engine: `list_tables` (with a glob `pattern`), `describe_table`, `get_table_indexes`, `get_foreign_keys`, `get_table_sample`.
- Query tools per engine family: `run_query` for SQL, `find_documents`, `aggregate`, `count_documents` and `distinct_values` for MongoDB, `search` for Elasticsearch and OpenSearch, `redis_command` for Redis.
- Two independent read-only layers on every engine, each proved by integration tests that send writes straight to the driver.
- A dialect-aware SQL validator that lexes PostgreSQL dollar quotes and `E''` strings, SQL Server brackets and ClickHouse heredocs, scans every T-SQL statement for writes, and refuses constructs it cannot read with certainty, such as nested comments and MySQL executable comments.
- SQLite runs in a separate process, so a query past the timeout is killed rather than freezing the server.
- Optional call logging (`DB_LOG`, `DB_LOG_FILE`, `DB_LOG_FORMAT`): every tool call with its input, each statement sent to the database, and the full output, in a readable boxed format or as JSON lines. Credentials are always redacted, and a logging failure never fails a call.
- A permanent log folder (`DB_LOG_DIR`): every entry saved as its own pretty JSON file, in a folder per day, never deleted, shared safely by every copy of the server.
- A live log viewer in the browser (`DB_LOG_PORT`, `DB_LOG_HISTORY`), paginated at 20 per page by default with 10, 20, 30 or 50 to choose from, filtering across everything logged, and showing every copy's calls when the folder is shared: each call appears the moment it finishes, with filtering, pause and copy. Off unless a port is set; it has no access control and listens on all interfaces. It binds on the first tool call, so the copy of the server actually in use gets the port, and a busy port is explained once in the chat and retried on every call.
