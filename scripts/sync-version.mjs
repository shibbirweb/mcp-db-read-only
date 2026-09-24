#!/usr/bin/env node
//
// Propagate the version in package.json to the places that cannot read it.
//
// After PackageVersionLoader, the server reports its version straight from
// package.json. Two files still carry it as data: the tag list in the Docker
// Hub description, which is prose, and server.json, which the MCP registry
// reads and which pins an exact version per package.
//
// Run by the `version` npm lifecycle script, so `npm version patch` bumps,
// syncs and stages in one step. Pass --check to verify without writing, which
// is what CI uses to catch a hand-edited version.
//
// Every target fails loudly when it cannot find what it expects to rewrite. A
// silent no-op would leave a stale version behind with a green exit code,
// which is the failure this script exists to prevent.
//
// Usage: node scripts/sync-version.mjs [--check]

import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const check = process.argv.includes("--check");

const version = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")).version;
const [major, minor] = version.split(".");

/** The published rolling tags, e.g. `1.2.3`, `1.2`, `1`, `latest`. */
const TAG_LINE = /^`\d+\.\d+\.\d+`, `\d+\.\d+`, `\d+`, `latest`/m;

/** An OCI identifier's trailing tag, e.g. docker.io/user/image:1.2.3. */
const IMAGE_TAG = /:[^:]+$/;

const targets = [
  {
    file: "README.dockerhub.md",
    rewrite(contents) {
      if (!TAG_LINE.test(contents)) {
        throw new Error("could not find the supported tags line");
      }
      return contents.replace(
        TAG_LINE,
        `\`${version}\`, \`${major}.${minor}\`, \`${major}\`, \`latest\``
      );
    },
  },
  {
    file: "server.json",
    rewrite(contents) {
      const document = JSON.parse(contents);
      document.version = version;

      const packages = document.packages ?? [];
      if (packages.length === 0) {
        throw new Error("no packages to update");
      }

      for (const entry of packages) {
        if (entry.registryType === "oci") {
          // The tag is the version here; the registry verifies against the
          // image that identifier names.
          entry.identifier = entry.identifier.replace(IMAGE_TAG, `:${version}`);
        } else {
          entry.version = version;
        }
      }

      return `${JSON.stringify(document, null, 2)}\n`;
    },
  },
];

let stale = false;

for (const target of targets) {
  const path = new URL(target.file, ROOT);
  const original = readFileSync(path, "utf8");

  let updated;
  try {
    updated = target.rewrite(original);
  } catch (error) {
    console.error(
      `${target.file}: ${error.message}. Update scripts/sync-version.mjs if that file was restructured.`
    );
    process.exit(1);
  }

  if (updated === original) {
    console.log(`${target.file} already lists ${version}.`);
    continue;
  }

  if (check) {
    console.error(`${target.file} is out of sync with package.json (${version}).`);
    stale = true;
    continue;
  }

  writeFileSync(path, updated);
  console.log(`${target.file} now lists ${version}.`);
}

if (stale) {
  console.error("Run: node scripts/sync-version.mjs");
  process.exit(1);
}
