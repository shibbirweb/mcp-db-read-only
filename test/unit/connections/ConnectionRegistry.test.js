import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionRegistry } from "../../../dist/connections/ConnectionRegistry.js";
import { ConnectionProfile } from "../../../dist/domain/ConnectionProfile.js";
import { target as buildTarget } from "../../helpers/targets.js";

const target = (database, overrides = {}) => buildTarget({ database, ...overrides });

const envProfile = (name, database) =>
  ConnectionProfile.fromEnvironment(name, target(database));

const registry = (...profiles) => new ConnectionRegistry(profiles);

describe("lookup", () => {
  const subject = registry(envProfile("alpha", "a"), envProfile("beta", "b"));

  test("lists in insertion order", () => {
    assert.deepEqual(subject.names(), ["alpha", "beta"]);
  });

  test("finds by name", () => {
    assert.equal(subject.find("beta").target.database, "b");
  });

  test("returns undefined for an unknown name", () => {
    assert.equal(subject.find("ghost"), undefined);
  });

  test("reports membership", () => {
    assert.equal(subject.has("alpha"), true);
    assert.equal(subject.has("ghost"), false);
  });
});

describe("choosing the starting profile", () => {
  test("honours the requested name", () => {
    const subject = registry(envProfile("alpha", "a"), envProfile("beta", "b"));
    assert.equal(subject.selectInitial("beta"), null);
    assert.equal(subject.getActiveName(), "beta");
  });

  test("warns and falls back when the name is unknown", () => {
    const subject = registry(envProfile("alpha", "a"));
    const warning = subject.selectInitial("ghost");
    assert.match(warning, /ghost/);
    assert.equal(subject.getActiveName(), "alpha");
  });

  test("prefers a profile named default", () => {
    const subject = registry(envProfile("zebra", "z"), envProfile("default", "d"));
    subject.selectInitial(null);
    assert.equal(subject.getActiveName(), "default");
  });

  test("otherwise takes the first profile", () => {
    const subject = registry(envProfile("alpha", "a"), envProfile("beta", "b"));
    subject.selectInitial(null);
    assert.equal(subject.getActiveName(), "alpha");
  });

  test("an empty registry leaves nothing active", () => {
    const subject = registry();
    assert.equal(subject.selectInitial(null), null);
    assert.equal(subject.getActiveTarget(), null);
  });
});

describe("requiring an active connection", () => {
  test("throws with a message naming both ways out", () => {
    assert.throws(() => registry().requireActiveTarget(), /connect|use_connection/);
  });

  test("returns the target once one is active", () => {
    const subject = registry(envProfile("alpha", "a"));
    subject.selectInitial(null);
    assert.equal(subject.requireActiveTarget().database, "a");
  });
});

describe("activating", () => {
  test("activateProfile points at that profile", () => {
    const subject = registry(envProfile("alpha", "a"), envProfile("beta", "b"));
    subject.activateProfile("beta");
    assert.equal(subject.getActiveTarget().database, "b");
  });

  test("activateProfile throws on an unknown name, listing the known ones", () => {
    const subject = registry(envProfile("alpha", "a"));
    assert.throws(() => subject.activateProfile("ghost"), /alpha/);
  });

  test("activateTarget sets an explicit target and label", () => {
    const subject = registry();
    subject.activateTarget(target("adhoc_db"), "adhoc");
    assert.equal(subject.getActiveName(), "adhoc");
    assert.equal(subject.getActiveTarget().database, "adhoc_db");
  });

  // Immutable targets remove any need for defensive copying: there is no way
  // to reach through the active target and edit the profile it came from.
  test("moving the active database cannot rewrite the stored profile", () => {
    const subject = registry(envProfile("alpha", "a"));
    subject.activateProfile("alpha");
    subject.activateTarget(subject.requireActiveTarget().withDatabase("elsewhere"), "alpha");

    assert.equal(subject.getActiveTarget().database, "elsewhere");
    assert.equal(subject.find("alpha").target.database, "a");
  });
});

describe("session profiles", () => {
  test("register adds an alias tagged as session", () => {
    const subject = registry();
    subject.register(ConnectionProfile.fromSession("adhoc", target("d")));
    assert.equal(subject.find("adhoc").origin, "session");
  });

  test("registering an existing name replaces it", () => {
    const subject = registry(envProfile("alpha", "a"));
    subject.register(ConnectionProfile.fromSession("alpha", target("corrected")));
    assert.equal(subject.find("alpha").target.database, "corrected");
    assert.equal(subject.names().length, 1);
  });
});

describe("profile rendering", () => {
  test("marks the active profile and shows its origin", () => {
    assert.equal(
      envProfile("alpha", "a").describe(true),
      "* alpha (env, MySQL) -> mysql://reader@db:3306/a"
    );
  });

  test("indents an inactive profile", () => {
    assert.match(envProfile("alpha", "a").describe(false), /^ {2}alpha/);
  });

  test("never renders the password", () => {
    const profile = ConnectionProfile.fromSession("x", target("d", { password: "hunter2" }));
    assert.ok(!profile.describe(false).includes("hunter2"));
  });
});
