# Logging and Viewer

Keep a record of every query your assistant runs, and watch them live in your browser.

Logging is **off unless you turn it on**. When it's on, every tool call is recorded with:

- what the assistant asked for (the tool and its input)
- every statement actually sent to the database, with how long it took and how many rows came back
- the full result the assistant received
- when it happened, which connection it used, and which app (for example Claude Desktop) made it

**Passwords are never logged.** They are replaced with `***` before anything is written, and there is no setting to change that.

---

## The simple setup: save to a folder, view in a terminal

This is the recommended setup.

```mermaid
flowchart LR
    subgraph client["Your MCP client"]
        S1["server copy"]
        S2["another copy"]
    end
    S1 -->|"one file per call"| F[("Log folder<br/>DB_LOG_DIR")]
    S2 -->|"one file per call"| F
    F -->|"checked every second"| V["viewer command<br/>(separate terminal)"]
    V -->|"live page"| B["Your browser<br/>http://127.0.0.1:4800"]
```

The servers only write files; the viewer only reads them. Starting or stopping the viewer never affects your assistant.

### 1. Tell the server to save logs

Add `DB_LOG_DIR` to the server's `env`:

```json
"env": {
  "DB_URL": "postgres://readonly@localhost/app",
  "DB_LOG_DIR": "/Users/me/Library/Logs/mcp-db-read-only"
}
```

Restart your client. From now on, every call is saved as its own file:

```text
/Users/me/Library/Logs/mcp-db-read-only/
  2026-09-25/
    103014-221Z_p72440_c000012_run_query_ok.json
    103020-005Z_p72440_c000013_run_query_failed.json
```

- One folder per day (UTC).
- The file name tells you the time, the process, the tool, and whether it worked, so you can find things with `ls` or `grep` without opening them.
- Each file is readable JSON.
- Files and folders are readable by you only.
- **Nothing is ever deleted automatically.** Remove old day folders yourself when you no longer need them.

If your client runs several copies of the server (Claude Desktop does, one per chat surface), they all save into the same folder safely.

### 2. Open the viewer when you want to watch

In a terminal:

```bash
npx -y @shibbirweb/mcp-db-read-only viewer --dir /Users/me/Library/Logs/mcp-db-read-only --port 4800
```

Then open **http://127.0.0.1:4800/** in your browser. Press **Ctrl+C** in the terminal to stop it; this does not affect your assistant.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--dir`, `-d` | the `DB_LOG_DIR` variable | The log folder |
| `--port`, `-p` | `4800` | The port for the page |
| `--host` | `0.0.0.0` | The network address to listen on |
| `--help`, `-h` | | Show help |

If the port is already in use, the viewer stops with a message saying which program holds it. Close that program, or choose another port.

---

## Using the viewer

- **Newest first, 20 per page.** Choose 10, 20, 30 or 50 per page at the top or bottom; your choice is remembered in this browser.
- **Live.** New calls appear at the top of page 1 as they happen. If you're reading an older page, a "new entries" button appears instead, so the page doesn't jump.
- **Every copy, every day.** The viewer shows everything in the folder, from every copy of the server and across restarts.
- **Click a call** to open it: connection, input, each statement sent, and the output or error.
- **Copy** anything with the icon in the corner of each block, or a whole entry with "Copy entry as JSON".
- **Filter** by any text, by tool, or to failures only. Filters search everything saved, not just the page you're on.
- **Pause** stops page 1 updating while you read.
- **Expand all** opens every call on the page.
- Light or dark, following your system.
- **Like it, or missing something?** The footer links to the GitHub repository, where you can give it a star, and to its issues page, to request a feature or report a problem.

> **The viewer has no password.** It listens on every network interface, so anyone who can reach that port (for example, on the same Wi-Fi) can read the log while it runs. Use it on a network you trust, or add `--host 127.0.0.1` to limit it to your own computer.

---

## Other ways to log

### To the client's own log: `DB_LOG=true`

Writes each call as a readable block to the server's error output, which your client keeps. For Claude Desktop that's `~/Library/Logs/Claude/mcp-server-<name>.log`.

```text
┌─ #3 run_query · ok · 38 ms · 2026-09-25T10:14:03.221Z
│ connection  app (PostgreSQL) postgres://readonly@localhost:5432/app
│ process     claude-ai, pid 72440
│ input
│   {
│     "query": "SELECT COUNT(*) AS n FROM members"
│   }
│ statements (3)
│   1. PostgreSQL · 1 ms · ok
│      BEGIN TRANSACTION READ ONLY; ...
│   2. PostgreSQL · 12 ms · 1 row
│      SELECT COUNT(*) AS n FROM members
│   3. PostgreSQL · 0 ms · ok
│      ROLLBACK
│ output
│   [ { "n": 17440 } ]
└─
```

### To one file: `DB_LOG_FILE=/path/calls.log`

The same blocks, appended to one file. Add `DB_LOG_FORMAT=json` for one JSON object per line instead, which suits `jq` and log collectors.

### The viewer inside the server: `DB_LOG_PORT`

`DB_LOG_PORT=4800` makes the server itself serve the viewer, starting on its first tool call. It needs one of the logging settings above as well. This works, but when a client runs several copies of the server only one can have the port, so the separate `viewer` command is usually simpler.

You can combine settings, for example `DB_LOG_DIR` plus `DB_LOG=true`.

---

## Logging with Docker

The folder has to be mounted so the files outlive the container:

```json
"args": [
  "run", "-i", "--rm",
  "-v", "/Users/me/Library/Logs/mcp-db-read-only:/logs",
  "-e", "DB_URL=postgres://readonly:secret@host.docker.internal/app",
  "-e", "DB_LOG_DIR=/logs",
  "shibbirweb/mcp-db-read-only"
]
```

The viewer can run from Docker too, reading the same folder:

```bash
docker run --rm -p 127.0.0.1:4800:4800 -v /Users/me/Library/Logs/mcp-db-read-only:/logs:ro \
  shibbirweb/mcp-db-read-only node dist/index.js viewer --dir /logs --port 4800
```

---

## Privacy

With logging on, the log holds every query and every result the assistant saw. It stays on your computer: the server never uploads it anywhere. Treat the folder like the data it contains. See [PRIVACY.md](https://github.com/shibbirweb/mcp-db-read-only/blob/master/PRIVACY.md).
