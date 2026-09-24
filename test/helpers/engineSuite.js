import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "./client.js";

/**
 * The integration suite every engine runs, driven by a fixture module.
 *
 * One suite rather than eight copies, because the browse tools promise the
 * same behaviour on every engine, and a promise is only kept everywhere if it
 * is tested everywhere by the same code. Each fixture supplies its seed data,
 * what to expect of it, and its engine-specific tests (the query tools and the
 * read-only proofs) through `extraTests`.
 *
 * A fixture whose server is unreachable skips the whole suite and says so on
 * stderr with a fixed phrase, which CI greps for so that a broken service
 * container cannot pass as a green build.
 */
export async function defineEngineSuite(fixture) {
  const unreachable = await fixture.probe();
  const suite = unreachable ? describe.skip : describe;

  if (unreachable) {
    console.error(`# integration tests skipped, ${fixture.label} not reachable: ${unreachable}`);
  }

  suite(`${fixture.label} through the MCP server`, () => {
    const context = { client: null };

    before(async () => {
      await fixture.seed();
      context.client = new McpClient({ DB_PROFILES: JSON.stringify(fixture.profiles()) });
      await context.client.initialize();
    });

    after(async () => {
      if (context.client) {
        await context.client.close();
      }
      await fixture.teardown();
    });

    const call = (name, args) => context.client.call(name, args);

    describe("browsing", () => {
      test("current_connection names the engine", async () => {
        const { text } = await call("current_connection");
        assert.match(text, new RegExp(`Engine: ${fixture.label}`));
      });

      test("list_tables lists the fixture objects", async () => {
        const { text, isError } = await call("list_tables");
        assert.equal(isError, false, text);
        for (const name of fixture.objects) {
          assert.ok(text.includes(name), `${name} missing from:\n${text}`);
        }
      });

      test("list_tables filters by a glob pattern", async () => {
        const { text } = await call("list_tables", { pattern: fixture.pattern.glob });
        assert.ok(text.includes(fixture.pattern.includes), text);
        assert.ok(!text.includes(fixture.pattern.excludes), text);
      });

      test("describe_table describes", async () => {
        const { text, isError } = await call("describe_table", { table: fixture.describe.name });
        assert.equal(isError, false, text);
        assert.match(text, fixture.describe.match);
      });

      test("describe_table on something missing says it does not exist", async () => {
        const { text, isError } = await call("describe_table", { table: fixture.missing });
        assert.equal(isError, true);
        assert.match(text, /No \w+ named|not found|no such/i);
      });

      test("get_table_sample returns real data", async () => {
        const { text, isError } = await call("get_table_sample", { table: fixture.sample.name, limit: 1 });
        assert.equal(isError, false, text);
        assert.match(text, fixture.sample.match);
      });
    });

    if (fixture.alt) {
      describe("switching databases", () => {
        test("list_databases shows both fixture databases and marks the active one", async () => {
          const { text } = await call("list_databases");
          assert.match(text, new RegExp(`\\* ${fixture.database}\\b`));
          assert.ok(text.includes(fixture.alt.database), text);
        });

        test("a per-call database reads elsewhere without switching", async () => {
          const { text } = await call("list_tables", { database: fixture.alt.database });
          assert.ok(text.includes(fixture.alt.object), text);
          const current = await call("current_connection");
          assert.ok(!current.text.includes(`/${fixture.alt.database}`), current.text);
        });

        test("use_database switches, and switching back restores the original", async () => {
          await call("use_database", { database: fixture.alt.database });
          assert.ok((await call("list_tables")).text.includes(fixture.alt.object));
          await call("use_database", { database: fixture.database });
          assert.ok((await call("list_tables")).text.includes(fixture.objects[0]));
        });

        test("a nonexistent database fails the switch and leaves the connection working", async () => {
          if (!fixture.alt.missingFails) {
            return;
          }
          const { isError } = await call("use_database", { database: "mcp_no_such_db" });
          assert.equal(isError, true);
          assert.ok((await call("list_tables")).text.includes(fixture.objects[0]));
        });
      });
    }

    if (fixture.extraTests) {
      describe(`${fixture.label} specifics`, () => {
        fixture.extraTests(call);
      });
    }
  });
}

/** Timeouts short enough for tests, long enough for a cold container. */
export const TEST_TUNING = { connectionLimit: 1, connectTimeoutMs: 10000, queryTimeoutMs: 15000 };
