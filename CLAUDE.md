# CLAUDE.md

Guidance for Claude Code working in this repository.

This is a standalone project, not part of the KP Dashboard product. The monorepo conventions in the parent `CLAUDE.md` about Laravel, Vue and the Action Center do not apply here. The general working rules, such as commit message style and never pushing, do.

## What this is

A read-only MCP server for MySQL, MariaDB, PostgreSQL, SQLite, SQL Server, ClickHouse, MongoDB, Redis, Elasticsearch and OpenSearch, whose connection (and engine) can be changed mid-conversation without restarting the client. TypeScript, ESM, Node 22.13+, no framework. Distributed three ways from one codebase: an npm package, a Docker image, and a listing on the MCP Registry.

It generalises `../mcp-mysql-read-only-server/` and follows the same architecture. Deep documentation lives in `docs/wiki/`, which explains why each class is shaped the way it is. Read `docs/wiki/Architecture.md` before changing structure, and `docs/wiki/Read-Only-Enforcement.md` before touching anything in `src/validation/` or `src/drivers/`.

## Environment

Node 22.13 or newer is required (for the built-in `node:sqlite`). The shell here defaults to Herd's Node 16, which breaks the build, so start with:

```bash
export NVM_DIR="$HOME/Library/Application Support/Herd/config/nvm"
. "$NVM_DIR/nvm.sh" && nvm use 22
```

## Commands

```bash
npm run build            # tsc to dist/
npm run typecheck        # tsc --noEmit
npm test                 # build, then every test
npm run test:unit        # unit tests only
npm run test:integration # integration tests; each engine's suite skips if unreachable
npm run sync-version     # propagate package.json version to the files that cannot read it
./scripts/test-in-docker.sh                      # full suite against throwaway containers
ENGINES="postgres redis" ./scripts/test-in-docker.sh
```

Tests are `node:test`, no framework. Unit tests mirror `src/` under `test/unit/`. Integration tests share one suite, `test/helpers/engineSuite.js`, driven by one fixture per engine in `test/helpers/engines/`. The SQLite and handshake suites need no server and always run. The others skip themselves when their engine is unreachable, which is why CI fails on the phrase "not reachable" rather than trusting a green tick.

## Invariants

These are the things the project exists to guarantee. Do not weaken them to make something else easier.

- **Read-only, in two independent layers, on every engine.** Layer one runs in the tools before a driver is touched (SQL validator, MongoDB operator guard, Redis allowlist, search body allowlist). Layer two is enforced by the database server wherever the engine offers a way (read-only session or transaction, always-rolled-back transaction, ClickHouse `readonly`, Redis `COMMAND INFO` flags, SQLite read-only open) and structurally where it does not (MongoDB stage allowlist, fixed Elasticsearch endpoints). The layers are independent on purpose: a bug in one must not become a write. Never add a tool that writes, and never give a driver a generic "send anything" method.
- **The SQL lexer must read a statement exactly as the server does.** Where it cannot be sure, it reports an ambiguity and the statement is refused. Never resolve an ambiguity by guessing.
- **Credentials never reach output.** `ConnectionTarget.key()` excludes the password and secret URL options by construction, and that same string is what gets logged and displayed. `InvalidConnectionUrlError` never echoes the URL.
- **Nothing is written to disk and nothing is sent anywhere but the configured databases.** No telemetry, no analytics, no update check. `PRIVACY.md` states this publicly, so a change here makes that document false.
- **stdout carries JSON-RPC only.** Every diagnostic goes through the injected logger to stderr. One stray `console.log` corrupts the protocol. The SQLite worker process has its stdout disconnected for the same reason.

## Adding an engine

1. Describe it in `EngineCatalog` (`src/domain/Engine.ts`): schemes, default port, family, whether it switches databases.
2. Write a driver in `src/drivers/<family>/` extending `BaseDriver` and implementing the family interface from `DatabaseDriver.ts`. Import the client library dynamically inside the driver, never at module top level. Give it a server-side read-only layer, or say plainly in its doc comment why none exists.
3. Register it in `ApplicationFactory.createDriverRegistry`. That is the only file that names driver classes.
4. For a SQL engine, add a dialect to `SqlDialects` and test its lexing in `SqlSkeletonizer.test.js`.
5. Add a fixture in `test/helpers/engines/`, an entry file in `test/integration/`, a service in `ci.yml`, and a container in `scripts/test-in-docker.sh`.

## Adding a tool

One class per tool, in its own file named after the class, holding its name, description, input schema and implementation together. Extend `BaseTool`, or `DatabaseScopedTool` when the tool reads through the active connection, and register it in `ApplicationFactory`. A query tool for one family sets `family`, so calling it against the wrong engine names the right tools; add it to `QUERY_TOOLS` too.

- Implement `execute` (or `read` for a database-scoped tool). Never override `register` or `invoke`.
- Declare `annotations` in the tool's own class, typed `ToolHints`: a `title` plus **all four** hints. There is deliberately no default in `BaseTool`.
- The description is written for a model, not a person. State what the tool does and stop. `PRIVACY.md` makes this a public claim.
- Keep the description honest about capability. If it says read, it must not mutate.

## Versioning

`package.json` is the single source of truth. The handshake version is read from it at startup by `PackageVersionLoader`, so **never hardcode a version anywhere**.

`README.dockerhub.md` (the tag line) and `server.json` carry it as data. `scripts/sync-version.mjs` owns both, CI runs it with `--check`, and the `version` npm lifecycle runs and stages it. Bump with:

```bash
npm version patch --no-git-tag-version   # or minor, or major
```

## Releasing

Bump on the branch, merge to `master` with CI green, then publish a GitHub release and let it create the tag. Three workflows run from that release: Docker Hub, npm, and the MCP Registry. The Docker Hub and npm workflows call `ci.yml` as their verify step, so a release is tested by exactly the same jobs as a pull request. `docs/wiki/Release-Process.md` is the full description.

- **npm publishes over OIDC trusted publishing.** No `NPM_TOKEN` secret should ever be added.
- **An npm version is immutable.** A bad publish is corrected only by a higher version.
- **The registry verifies against published artifacts**, so its workflow waits for npm and the image to be live before publishing. `server.json`'s description is capped at 100 characters, which CI checks.

## Documentation

- `README.md` and `README.dockerhub.md` carry the same user-facing content. Docker Hub renders neither mermaid nor relative links, so that copy uses ASCII diagrams and absolute URLs. **Change one, change the other.**
- `docs/wiki/` is the source of truth for the GitHub wiki and is mirrored on merge. Edit it here, never in the browser.

## Style

- Comments explain **why**, not what, including what was tried before and why it failed. Match that.
- Semicolons, trailing commas in multi-line literals, full curly braces on every `if`.
- Never use the em dash character, in code, comments, commits, docs or PR text.
- Prefer a named class with a constructor argument over a module-level singleton, so tests can pass a fake.

## Git

- Conventional commit subjects: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`. No Jira ticket here.
- Use the personal git identity, configured locally on this repository.
- No `Co-Authored-By` lines.
- **Never commit without being asked, and never push.**
