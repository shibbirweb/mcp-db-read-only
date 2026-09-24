import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionManager } from "../../../dist/connections/ConnectionManager.js";
import { ConnectionRegistry } from "../../../dist/connections/ConnectionRegistry.js";
import { ConnectionProfile } from "../../../dist/domain/ConnectionProfile.js";
import { engineTarget, target as buildTarget } from "../../helpers/targets.js";

/**
 * A stand-in for DriverCache.
 *
 * Injecting the verifier is what makes these tests possible at all: the
 * verify-then-commit rule is the reason a failed switch is harmless, and it
 * would otherwise only be exercisable against a real database.
 */
class FakeVerifier {
  constructor({ failOn = [] } = {}) {
    this.failOn = failOn;
    this.verified = [];
  }

  async verify(target) {
    this.verified.push(target.key());
    if (this.failOn.includes(target.database)) {
      throw new Error(`Unknown database '${target.database}'`);
    }
  }
}

const target = (database) => buildTarget({ database });

function build({ failOn = [], extra = [] } = {}) {
  const registry = new ConnectionRegistry([
    ConnectionProfile.fromEnvironment("primary", target("app")),
    ConnectionProfile.fromEnvironment("secondary", target("analytics")),
    ...extra,
  ]);
  registry.selectInitial("primary");

  const verifier = new FakeVerifier({ failOn });
  return { registry, verifier, manager: new ConnectionManager(registry, verifier) };
}

describe("useDatabase", () => {
  test("moves the active database", async () => {
    const { manager } = build();
    await manager.useDatabase("reporting");
    assert.equal(manager.getActiveTarget().database, "reporting");
  });

  test("verifies before committing", async () => {
    const { manager, verifier } = build();
    await manager.useDatabase("reporting");
    assert.deepEqual(verifier.verified, ["mysql://reader@db:3306/reporting"]);
  });

  test("a failed verification leaves the previous connection active", async () => {
    const { manager } = build({ failOn: ["missing"] });
    await assert.rejects(() => manager.useDatabase("missing"), /Unknown database/);
    assert.equal(manager.getActiveTarget().database, "app");
  });

  test("keeps the profile label, since the connection is still that profile", async () => {
    const { manager } = build();
    await manager.useDatabase("reporting");
    assert.equal(manager.getActiveName(), "primary");
  });

  test("does not rewrite the profile it moved away from", async () => {
    const { manager, registry } = build();
    await manager.useDatabase("reporting");
    assert.equal(registry.find("primary").target.database, "app");
  });

  test("SQLite refuses before any network work, naming the way out", async () => {
    const { manager, registry, verifier } = build({
      extra: [ConnectionProfile.fromEnvironment("file", engineTarget("sqlite"))],
    });
    registry.activateProfile("file");
    await assert.rejects(() => manager.useDatabase("other"), /SQLite has no separate databases.*connect/);
    assert.deepEqual(verifier.verified, []);
  });

  test("Elasticsearch refuses too", async () => {
    const { manager, registry } = build({
      extra: [ConnectionProfile.fromEnvironment("search", engineTarget("elasticsearch"))],
    });
    registry.activateProfile("search");
    await assert.rejects(() => manager.useDatabase("logs"), /Elasticsearch has no separate databases/);
  });
});

describe("useProfile", () => {
  test("switches to the named profile", async () => {
    const { manager } = build();
    await manager.useProfile("secondary");
    assert.equal(manager.getActiveTarget().database, "analytics");
    assert.equal(manager.getActiveName(), "secondary");
  });

  test("applies a database override", async () => {
    const { manager } = build();
    await manager.useProfile("secondary", "other");
    assert.equal(manager.getActiveTarget().database, "other");
  });

  test("an override does not mutate the stored profile", async () => {
    const { manager, registry } = build();
    await manager.useProfile("secondary", "other");
    assert.equal(registry.find("secondary").target.database, "analytics");
  });

  test("an unknown profile throws before any network work", async () => {
    const { manager, verifier } = build();
    await assert.rejects(() => manager.useProfile("ghost"), /Unknown profile/);
    assert.deepEqual(verifier.verified, [], "must not attempt to verify an unknown profile");
  });

  test("the error lists the known profiles", async () => {
    const { manager } = build();
    await assert.rejects(() => manager.useProfile("ghost"), /primary, secondary/);
  });

  test("a failed verification leaves the previous connection active", async () => {
    const { manager } = build({ failOn: ["analytics"] });
    await assert.rejects(() => manager.useProfile("secondary"));
    assert.equal(manager.getActiveName(), "primary");
  });

  test("switching across engines works like any other switch", async () => {
    const { manager } = build({
      extra: [ConnectionProfile.fromEnvironment("cache", engineTarget("redis"))],
    });
    await manager.useProfile("cache", "3");
    assert.equal(manager.getActiveTarget().engine, "redis");
    assert.equal(manager.getActiveTarget().database, "3");
  });
});

describe("connect", () => {
  test("activates the target and registers the alias", async () => {
    const { manager, registry } = build();
    await manager.connect(target("adhoc_db"), "adhoc");

    assert.equal(manager.getActiveName(), "adhoc");
    assert.equal(manager.getActiveTarget().database, "adhoc_db");
    assert.equal(registry.find("adhoc").origin, "session");
  });

  test("the alias can be returned to later", async () => {
    const { manager } = build();
    await manager.connect(target("adhoc_db"), "adhoc");
    await manager.useProfile("primary");
    await manager.useProfile("adhoc");
    assert.equal(manager.getActiveTarget().database, "adhoc_db");
  });

  test("a failed connection registers nothing", async () => {
    const { manager, registry } = build({ failOn: ["unreachable"] });
    await assert.rejects(() => manager.connect(target("unreachable"), "adhoc"));

    assert.equal(registry.find("adhoc"), undefined);
    assert.equal(manager.getActiveName(), "primary");
  });
});
