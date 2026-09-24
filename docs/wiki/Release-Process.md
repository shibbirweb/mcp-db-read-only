# Release Process

Five workflows in `.github/workflows/`.

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | PR to `master`, push to `master` | Typecheck, build, the full suite against every engine (once with MySQL 8.4, once with MariaDB 11.4), multi-arch image build, handshake smoke test, npm tarball install test. Also callable by other workflows |
| `docker-publish.yml` | GitHub release published, manual | Runs `ci.yml` against the tag, then builds and pushes to Docker Hub |
| `npm-publish.yml` | GitHub release published, manual | Runs `ci.yml` against the tag, then publishes the package to npm |
| `mcp-registry-publish.yml` | GitHub release published, manual | Waits for both artifacts, then publishes `server.json` to the MCP Registry |
| `wiki.yml` | Push to `master` touching `docs/wiki/**`, manual | Mirrors `docs/wiki/` into the GitHub wiki |

The three publish workflows run independently off the same release, so a failure on one does not block the others, and any of them can be re-run on its own from `workflow_dispatch`.

`mcp-registry-publish.yml` is the exception to that independence, and only in timing: the registry hosts no artifacts and verifies ownership against the published npm package and image, so it waits for both to appear before publishing rather than racing them.

```mermaid
flowchart LR
    PR["pull request<br/>to master"] --> CI1["ci.yml<br/>every engine, MySQL + MariaDB legs<br/>amd64 + arm64 build"]
    CI1 --> MERGE["merge to master"]
    MERGE --> CI2["ci.yml again"]
    MERGE --> WIKI{"docs/wiki changed?"}
    WIKI -->|"yes"| PUB["wiki.yml<br/>mirror to GitHub wiki"]
    MERGE --> TAG["tag vX.Y.Z<br/>publish a release"]
    TAG --> VER["docker-publish.yml<br/>ci.yml + tag matches package.json"]
    TAG --> VERN["npm-publish.yml<br/>ci.yml + tag matches package.json"]
    VER -->|"green"| PUSH["publish<br/>multi-arch to Docker Hub"]
    VER -->|"red"| STOP["nothing published"]
    VERN -->|"green"| PUSHN["publish<br/>package to npm"]
    VERN -->|"red"| STOP
    TAG --> MCPW["mcp-registry-publish.yml<br/>wait for both artifacts"]
    PUSH --> MCPW
    PUSHN --> MCPW
    MCPW --> MCP["publish server.json<br/>to the MCP Registry"]

    style STOP fill:#fde,stroke:#b55
    style PUSH fill:#dfd,stroke:#5b5
    style PUSHN fill:#dfd,stroke:#5b5
    style MCP fill:#dfd,stroke:#5b5
```

## One-time setup

### Docker Hub secrets

Create the repository `shibbirweb/mcp-db-read-only` on Docker Hub, then in the GitHub repository's **Settings, Secrets and variables, Actions**:

| Secret | Value |
| --- | --- |
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | A Docker Hub personal access token with **Read, Write, Delete** |

Use a token, not your password: it is scoped and revocable on its own. Read and Write is enough to push an image, but `dockerhub-description.yml` also edits the repository description, which needs Delete as well; a push-only token publishes the image and then fails the description step with a bare `Forbidden`.

The publish workflow checks both are present and fails with a clear message if not, rather than failing later inside the login step.

### npm publishing

`npm-publish.yml` authenticates over OIDC against a trusted publisher. There is no npm token anywhere: not in the repository, not in a secret, not on a maintainer's machine. The workflow declares `id-token: write`, npm exchanges that token for publish rights, and provenance is attached automatically because the package and the repository are both public.

It is configured once on npmjs.com under the package's **Settings, Trusted publishers**, pointing at this repository and `npm-publish.yml`. It must grant the **`npm publish`** permission. A trust configuration created after 3 September 2026 defaults to `npm stage publish` only, which sends releases to a staging area for manual 2FA approval instead of publishing them, and a workflow running `npm publish` against a stage-only configuration is rejected.

Do not add an `NPM_TOKEN` secret. The workflow no longer reads one, and a token is a long-lived credential that OIDC exists to make unnecessary.

**One step has to be done by hand, once.** A trusted publisher cannot be configured for a package that does not exist yet, so the first version must be published manually to create it (`npm publish --access public` from a clean checkout of the release tag, with 2FA). The MySQL-only predecessor had to do the same. After that, configure the trusted publisher and nothing needs publishing by hand again.

### MCP Registry publishing

`mcp-registry-publish.yml` authenticates with `mcp-publisher login github-oidc`, which trades the workflow's OIDC token for the `io.github.shibbirweb/*` namespace. No secret is needed and none should be added.

The registry stores metadata only. It proves the entry belongs to us by reading two things off artifacts we already publish:

| Package entry | Proof | Where it lives |
| --- | --- | --- |
| npm | `mcpName` must equal the name in `server.json` | `package.json` |
| oci | `io.modelcontextprotocol.server.name` annotation must equal it too | `Dockerfile` |

Both are checked against the **published** artifact, not the working tree, which is why the workflow waits for the npm version and the image tag to appear before publishing. The image annotation in particular only counts once an image carrying it is on Docker Hub, so adding that label never takes effect in the release it lands in; it takes effect in the next one.

`server.json` is versioned in the repository and kept in step with `package.json` by `scripts/sync-version.mjs`, including the tag inside the `oci` identifier. CI additionally asserts that `server.json` and `package.json` still name the same package, because a rename is only rejected at publish time, which is after the npm version has become immutable.

### Initialise the wiki

**The wiki repository does not exist until the first page is created.** Open the repository's Wiki tab, create any page, save it. `wiki.yml` will then overwrite it on the next run.

Without this the workflow fails at the clone step; it prints an explicit message saying what to do.

If your organisation does not allow `GITHUB_TOKEN` to write the wiki, create a fine-grained PAT with wiki write access and store it as `WIKI_TOKEN`. The workflow prefers it and falls back to `GITHUB_TOKEN`.

## Cutting a release

1. On the release branch, bump the version. Never by hand:
   ```bash
   npm version patch --no-git-tag-version   # or minor, or major
   ```
   This writes `package.json` and the lockfile, runs `scripts/sync-version.mjs` to rewrite the tag list in `README.dockerhub.md`, and stages that file. Commit it with the rest of the branch.
2. Merge to `master` with CI green.
3. Publish a GitHub release for the new version, letting GitHub create the tag `v1.2.3` on the merge commit.
4. `docker-publish.yml` and `npm-publish.yml` both run automatically.

`--no-git-tag-version` matters. Plain `npm version` tags immediately, on the branch commit, which is not the commit that ends up on `master`. The release would then build from a tree `master` never had. Tagging belongs to step 3, after the merge.

### One version, in one place

`package.json` is the source of truth, and everything that can derive from it does.

The version a client sees in the MCP handshake is read at startup by `PackageVersionLoader`, so it cannot drift: `McpDbServer` takes `version` as a required constructor argument with no default, because a default is a second place to remember and the one that silently wins when it is forgotten. `package.json` is present in every way this server ships, including the runtime image, which copies it in before the build output.

The one copy that cannot read `package.json` is the tag list in `README.dockerhub.md`, because it is prose. `scripts/sync-version.mjs` writes it, `npm run sync-version` runs it on its own, and `node scripts/sync-version.mjs --check` fails without writing. CI runs the check, so a hand-edited version is caught on the pull request. If the tags section is ever restructured, the script fails loudly rather than quietly matching nothing.

### The tag must match package.json

Both publish workflows compare the release tag against `package.json` and fail if they disagree. A release tagged `v1.2.0` built from a tree still saying `1.1.0` ships an artifact whose version contradicts its own release notes, and on npm that cannot be taken back. Following step 1 above makes the mismatch impossible, since the tag is created from the same bump.

### Tags produced

A release of `v1.2.3` pushes:

```
shibbirweb/mcp-db-read-only:1.2.3
shibbirweb/mcp-db-read-only:1.2
shibbirweb/mcp-db-read-only:1
shibbirweb/mcp-db-read-only:latest
```

`latest` is skipped for prereleases, so tagging `v2.0.0-rc.1` does not hand every `latest` user a release candidate.

The rolling `1.2` and `1` tags let people pin to a compatibility level rather than an exact build or an unpinned `latest`.

### npm dist-tags

A normal release publishes under `latest`, which is what a bare `npx @shibbirweb/mcp-db-read-only` resolves to. A GitHub prerelease publishes under `next` instead, for the same reason `latest` is withheld on Docker Hub.

An npm version is permanent. It cannot be replaced, and unpublishing is restricted, so a mistake is corrected only by releasing a higher version. `npm-publish.yml` refuses upfront if the version in `package.json` is already on the registry, which is what a re-run of an already-published release would otherwise hit as an opaque `E403`.

The tarball is built by `prepack`, which runs for both `npm pack` and `npm publish`, so `dist/` cannot be stale: it is gitignored and therefore never comes from the checkout. `prepack` rather than `prepublishOnly` is what lets CI pack and test the exact artifact a release would send.

## Verification before publishing

Both publish workflows gate on two jobs, and `publish` does not run unless both pass: `verify`, which calls `ci.yml` against the exact ref being released, and `check-tag`.

Calling `ci.yml` repeats CI on purpose: a release can be cut from a tag that CI never saw in that exact state, and publishing an untested artifact is the one mistake that reaches users directly. The MySQL-only predecessor kept a hand-written copy of the test job in each publish workflow; with eight engines as service containers, three copies would drift, so the publish workflows call the one definition instead. Each still runs its own instance of it, so neither release channel ships on the strength of the other one's green tick.

## Multi-arch builds

Images are built for `linux/amd64` and `linux/arm64`, using QEMU on the amd64 runner for the arm64 layers. Apple Silicon is a large share of the audience for a locally-run MCP server, and an emulated image there is noticeably slow.

Both platforms are also built on every PR, without pushing, so a break in the arm64 path is caught during review rather than during a release.

Build cache uses GitHub Actions cache (`type=gha`), which keeps the arm64 build from dominating CI time.

## Docker Hub description

The Docker Hub page is not synced by the publish workflow. `dockerhub-description.yml` owns it, running on pushes to `master` that touch `README.dockerhub.md`, which is a second description written for that audience rather than a copy of `README.md`.

Keeping it out of the release means a wording change does not need a release to ship, and a failure to update the description cannot redden a release that published perfectly well.

## Publishing the wiki

`wiki.yml` mirrors `docs/wiki/` into the wiki repository on merge to `master`.

The wiki lives in a separate git repository that GitHub does not keep in sync with the code. Keeping the source in `docs/wiki/` means documentation is reviewed in pull requests alongside the change it describes, instead of being edited in a browser where it silently drifts.

The copy step deletes the wiki's top-level `*.md` first, so a page removed from `docs/wiki/` also disappears from the wiki. Anything committed directly through the wiki UI is overwritten on the next sync: `docs/wiki/` is the source of truth.

Page names come from filenames, so `Read-Only-Enforcement.md` becomes a page linked as `[Read Only Enforcement](Read-Only-Enforcement)`. `_Sidebar.md` is GitHub's special name for the wiki navigation panel.

The job is serialised with a `concurrency` group so two quick merges cannot race to push the wiki.

## Manual runs

Every workflow accepts `workflow_dispatch`. `docker-publish.yml` and `npm-publish.yml` both take an optional tag input for re-publishing a specific tag, for example after fixing a Docker Hub credential or configuring a trusted publisher.
