import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { engineTarget, target } from "../../helpers/targets.js";

describe("identity", () => {
  test("the key names scheme, user, host, port and database", () => {
    assert.equal(target().key(), "mysql://reader@db:3306/app");
  });

  test("the key never contains the password", () => {
    assert.ok(!target({ password: "hunter2" }).key().includes("hunter2"));
  });

  test("the key never contains a secret option", () => {
    const withKey = engineTarget("elasticsearch", { secretOptions: { api_key: "s3cr3t" } });
    assert.ok(!withKey.key().includes("s3cr3t"));
    assert.ok(!withKey.key().includes("api_key"));
  });

  test("public options are part of the key, in a stable order", () => {
    const a = target({ options: { ssl: "true", charset: "utf8" } });
    const b = target({ options: { charset: "utf8", ssl: "true" } });
    assert.equal(a.key(), b.key());
    assert.match(a.key(), /\?charset=utf8&ssl=true$/);
  });

  test("describe is the key, so display and identity cannot drift", () => {
    const subject = target({ password: "x" });
    assert.equal(subject.describe(), subject.key());
  });

  test("a SQLite target is identified by its path alone", () => {
    assert.equal(engineTarget("sqlite").key(), "sqlite:/data/app.db");
  });

  test("a replica set lists every host", () => {
    const set = engineTarget("mongodb", {
      hosts: [
        { host: "a", port: 27017 },
        { host: "b", port: 27018 },
      ],
    });
    assert.equal(set.key(), "mongodb://reader@a:27017,b:27018/app");
  });

  test("an SRV host has no port in its key", () => {
    const srv = engineTarget("mongodb", { scheme: "mongodb+srv", hosts: [{ host: "cluster.example.net", port: 0 }] });
    assert.equal(srv.key(), "mongodb+srv://reader@cluster.example.net/app");
  });
});

describe("equality", () => {
  test("same endpoint and credentials are equal", () => {
    assert.ok(target({ password: "p" }).equals(target({ password: "p" })));
  });

  test("a different password is not equal, though the key matches", () => {
    const a = target({ password: "old" });
    const b = target({ password: "new" });
    assert.equal(a.key(), b.key());
    assert.equal(a.equals(b), false);
  });

  test("a different secret option is not equal", () => {
    const a = engineTarget("elasticsearch", { secretOptions: { api_key: "one" } });
    const b = engineTarget("elasticsearch", { secretOptions: { api_key: "two" } });
    assert.equal(a.equals(b), false);
  });
});

describe("immutability", () => {
  test("withDatabase returns a copy and leaves the original alone", () => {
    const original = target();
    const moved = original.withDatabase("other");
    assert.equal(moved.database, "other");
    assert.equal(original.database, "app");
    assert.equal(moved.password, original.password);
  });

  test("fields cannot be reassigned", () => {
    const subject = target();
    assert.throws(() => {
      subject.database = "x";
    });
  });

  test("options cannot be mutated through the target", () => {
    const subject = target({ options: { ssl: "true" } });
    assert.throws(() => {
      subject.options.ssl = "false";
    });
  });

  test("hosts cannot be mutated through the target", () => {
    const subject = target();
    assert.throws(() => {
      subject.hosts[0].host = "elsewhere";
    });
  });
});

describe("options", () => {
  test("lookup ignores case, as connection-string conventions disagree", () => {
    const subject = target({ options: { TrustServerCertificate: "true" } });
    assert.equal(subject.option("trustservercertificate"), "true");
  });

  test("flags read true, 1 and yes as true", () => {
    for (const value of ["true", "1", "yes", "TRUE"]) {
      assert.equal(target({ options: { ssl: value } }).flag("ssl"), true, value);
    }
    assert.equal(target({ options: { ssl: "false" } }).flag("ssl"), false);
    assert.equal(target().flag("ssl"), undefined);
  });
});
