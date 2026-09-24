# syntax=docker/dockerfile:1.7

# Dependencies including devDependencies, shared by the build and test stages.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
WORKDIR /app
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Built with `--target test`. Kept in this file rather than a separate one so
# the tests always run against the same dependency tree as the release image.
FROM builder AS test
WORKDIR /app
COPY test/ ./test/
# No path argument: the runner discovers *.test.js itself. Passing a directory
# is not supported on every Node 22 patch release and fails as a missing module.
CMD ["node", "--test"]

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist

LABEL org.opencontainers.image.title="mcp-db-read-only" \
      org.opencontainers.image.description="Read-only MCP server for MySQL, PostgreSQL, SQLite, SQL Server, ClickHouse, MongoDB, Redis and Elasticsearch" \
      org.opencontainers.image.source="https://github.com/shibbirweb/mcp-db-read-only" \
      org.opencontainers.image.licenses="MIT"

# How the MCP registry proves this image is ours: it reads the annotation off
# the published image and requires it to equal the name in server.json. It is
# checked at publish time, not build time, so the value has to be on an image
# that is already on Docker Hub before the registry entry can go out.
LABEL io.modelcontextprotocol.server.name="io.github.shibbirweb/mcp-db-read-only"

# Every driver is pure JavaScript and SQLite is built into Node, so this one
# image runs unchanged on amd64 and arm64 with no native build step.
CMD ["node", "dist/index.js"]
