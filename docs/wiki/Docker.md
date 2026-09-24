# Docker

The image `shibbirweb/mcp-db-read-only` runs the same server with nothing else installed. It's built for Intel and Apple Silicon (`linux/amd64` and `linux/arm64`).

| Tag | Gets |
| --- | --- |
| `latest` | The newest release |
| `1` | The newest 1.x release (recommended: new features and fixes, never a breaking change) |
| `1.0` | The newest 1.0.x release |
| `1.0.0` | Exactly that version |

## In your MCP client

```json
{
  "mcpServers": {
    "databases": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--add-host", "host.docker.internal:host-gateway",
        "-e", "DB_URL=postgres://readonly:secret@host.docker.internal:5432/myapp",
        "shibbirweb/mcp-db-read-only:1"
      ]
    }
  }
}
```

- `-i` is required: the client talks to the server through its input and output.
- `--rm` removes the container when the client closes it.
- Pass every setting with its own `-e NAME=value`.

## Reaching a database on your computer

Inside a container, `localhost` means the container itself. Use **`host.docker.internal`** instead, and keep the `--add-host host.docker.internal:host-gateway` line (Docker Desktop has it built in, Linux needs the flag).

```mermaid
flowchart LR
    subgraph computer["Your computer"]
        DB[("Your database<br/>port 5432")]
        subgraph container["Docker container"]
            S["mcp-db-read-only"]
            L["localhost<br/>(the container itself)"]
        end
    end
    S -->|"host.docker.internal:5432<br/>reaches it"| DB
    S -.->|"localhost:5432<br/>finds nothing"| L
```

A database in another container? Put both on one Docker network and use the container's name as the host.

## SQLite files

Mount the folder, read-only, and use the path inside the container:

```json
"-v", "/Users/me/data:/data:ro",
"-e", "DB_URL=sqlite:///data/app.db"
```

## Logs

Mount a folder for `DB_LOG_DIR`, so the logs outlive the container:

```json
"-v", "/Users/me/Library/Logs/mcp-db-read-only:/logs",
"-e", "DB_LOG_DIR=/logs"
```

And view them, from Docker or with npx, as described on [Logging and Viewer](Logging-and-Viewer):

```bash
docker run --rm -p 127.0.0.1:4800:4800 -v /Users/me/Library/Logs/mcp-db-read-only:/logs:ro \
  shibbirweb/mcp-db-read-only node dist/index.js viewer --dir /logs --port 4800
```

`-p 127.0.0.1:4800:4800` makes the page reachable from your computer only.

## npm or Docker?

Both run the same code. npm (`npx`) starts a little faster and needs Node 22.13+. Docker needs nothing but Docker and keeps the server walled off from the rest of your computer: it can only reach what you pass in.
