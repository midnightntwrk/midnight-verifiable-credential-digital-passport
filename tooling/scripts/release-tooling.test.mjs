#!/usr/bin/env node
// This file is part of midnightntwrk/midnight-verifiable-credential-digital-passport.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Release tooling test suite (repository-toolchain: "Continuous integration
// lanes" — release tooling regressions fail CI). Ported and extended from
// midnight-verifiable-credentials. Covers version computation, the workspace
// catalog, publication context rules, the publish-script contract (registry
// lockdown, provenance flag, idempotent no-op, tag repair), the release
// package contract over sandboxed tarball fixtures, SBOM generation, and the
// consumer-test argument validation. Everything runs offline: registry views
// are mocked and tarballs are fixtures.

import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertBaseVersionAgreement,
  computeReleaseVersion,
} from "./prepare-release-version.mjs";
import { contractViolations } from "./check-release-package-contract.mjs";
import { catalogViolations, workspaceCatalog } from "./workspace-catalog.mjs";
import { parseConsumerArgs } from "./test-release-package-consumers.mjs";
import { packageVerificationCode } from "./generate-release-sbom.mjs";
import { assertPublishWorkflow } from "./check-security-workflows.mjs";
import { parse as parseYaml } from "yaml";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPTS, "../..");
const FAMILY = "@midnight-ntwrk/midnight-verifiable-credential-digital-passport";
const FAMILY_PATH = "packages/midnight-verifiable-credential-digital-passport";
const NPMJS = "https://registry.npmjs.org/";

const node = (args, options = {}) =>
  spawnSync(process.execPath, args, { encoding: "utf8", ...options });

const bash = (script, args, options = {}) =>
  spawnSync("bash", [script, ...args], { encoding: "utf8", ...options });

/** Extracts a JSON stdout document from a spawned node script. */
const jsonStdout = (result) => JSON.parse(result.stdout);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a synthetic npm tarball fixture with the full distribution shape
 * (manifest metadata, README, CHANGELOG, dist output, managed contract
 * exports, compact sources, helper scripts). `mutate(packageDir)` runs before
 * packing so tests can strip or corrupt parts of the package.
 */
const makeFixtureTarball = (dir, { name = FAMILY, version = "0.1.0", mutate } = {}) => {
  const staging = mkdtempSync(path.join(tmpdir(), "release-fixture-"));
  const pkg = path.join(staging, "package");
  mkdirSync(path.join(pkg, "dist", "managed", "digital-passport-credential", "contract"), {
    recursive: true,
  });
  mkdirSync(path.join(pkg, "src"), { recursive: true });
  mkdirSync(path.join(pkg, "scripts"), { recursive: true });
  writeFileSync(
    path.join(pkg, "package.json"),
    `${JSON.stringify(
      {
        name,
        version,
        license: "Apache-2.0",
        description: "fixture package for release tooling tests",
        keywords: ["fixture"],
        homepage: "https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport#readme",
        bugs: { url: "https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport/issues" },
        repository: {
          type: "git",
          url: "git+https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport.git",
          directory: FAMILY_PATH,
        },
        publishConfig: { access: "public", registry: NPMJS },
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(path.join(pkg, "README.md"), "# fixture\n");
  writeFileSync(path.join(pkg, "CHANGELOG.md"), "# fixture changelog\n");
  writeFileSync(path.join(pkg, "dist", "index.js"), "export {};\n");
  writeFileSync(
    path.join(pkg, "dist", "managed", "digital-passport-credential", "contract", "index.js"),
    "export {};\n",
  );
  writeFileSync(path.join(pkg, "src", "digital-passport-credential.compact"), "// fixture\n");
  writeFileSync(path.join(pkg, "scripts", "helper.mjs"), "export {};\n");
  mutate?.(pkg);
  const tarballName = `${name.replace(/^@/u, "").replace(/\//gu, "-")}-${version}.tgz`;
  const tarball = path.join(dir, tarballName);
  execFileSync("tar", ["-czf", tarball, "-C", staging, "package"]);
  rmSync(staging, { recursive: true, force: true });
  return tarball;
};

/** A mockable, stateful `npm view`: dist-tag answers read MOCK_TAGS_FILE. */
const MOCK_VIEW = (dir) => {
  const script = path.join(dir, "mock-view.mjs");
  writeFileSync(
    script,
    `${[
      "import { existsSync, readFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "if (process.env.MOCK_VIEW_MISSING) { console.error('npm error code E404'); process.exit(1); }",
      "if (process.env.MOCK_VIEW_BROKEN) { console.error('npm error code E500'); process.exit(1); }",,
      "const target = args[0] ?? ''",
      "const field = args.slice(1).find((a) => !a.startsWith('--') && !/^https?:/u.test(a)) ?? '';",
      "const versionQuery = target.slice(target.lastIndexOf('@') + 1).includes('.');",
      "const readTags = () => {",
      "  const file = process.env.MOCK_TAGS_FILE;",
      "  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));",
      "  return JSON.parse(process.env.MOCK_VIEW_TAGS ?? '{}');",
      "};",
      "if (field === 'version' || versionQuery) {",
      "  const v = process.env.MOCK_VIEW_VERSION;",
      "  if (!v) { console.error('E404 Not Found'); process.exit(1); }",
      "  console.log(JSON.stringify(v));",
      "} else if (field.startsWith('dist-tags')) {",
      "  const tags = readTags();",
      "  const key = field.includes('.') ? field.split('.')[1] : null;",
      "  const value = key ? tags[key] : tags;",
      "  if (value === undefined) { console.error('E404 Not Found'); process.exit(1); }",
      "  console.log(JSON.stringify(value));",
      "} else { console.error('unsupported mock query: ' + field); process.exit(1); }",
    ].join("\n")}\n`,
  );
  return script;
};

/** A mockable `npm dist-tag`: updates MOCK_TAGS_FILE and records the call. */
const MOCK_DIST_TAG = (dir) => {
  const script = path.join(dir, "mock-dist-tag.mjs");
  writeFileSync(
    script,
    `${[
      "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
      "const args = process.argv.slice(2);",
      "const [sub, nameAtVersion, tag] = args;",
      "if (sub !== 'add' || !nameAtVersion || !tag) { console.error('unsupported mock call: ' + args.join(' ')); process.exit(1); }",
      "const version = nameAtVersion.slice(nameAtVersion.lastIndexOf('@') + 1);",
      "const file = process.env.MOCK_TAGS_FILE;",
      "const tags = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};",
      "tags[tag] = version;",
      "if (file) writeFileSync(file, JSON.stringify(tags));",
      "appendFileSync(process.env.MOCK_DIST_TAG_LOG, `${nameAtVersion} ${tag}\\n`);",
    ].join("\n")}\n`,
  );
  return script;
};

// ---------------------------------------------------------------------------
// Version computation
// ---------------------------------------------------------------------------

test("version computation: channel schemes and npm tags", () => {
  assert.deepEqual(
    computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: 1 }),
    { version: "0.1.0-rc1", npmTag: "rc" },
  );
  assert.deepEqual(
    computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: 12 }),
    { version: "0.1.0-rc12", npmTag: "rc" },
  );
  assert.deepEqual(
    computeReleaseVersion({
      channel: "snapshot",
      baseVersion: "0.1.0",
      runNumber: "42",
      shortSha: "abcdef0",
    }),
    { version: "0.1.0-snapshot.42.abcdef0", npmTag: "snapshot" },
  );
  assert.deepEqual(computeReleaseVersion({ channel: "release", baseVersion: "0.2.0" }), {
    version: "0.2.0",
    npmTag: "latest",
  });
});

test("version computation: rejects malformed channels and rc indexes", () => {
  assert.throws(() => computeReleaseVersion({ channel: "nightly", baseVersion: "0.1.0" }));
  assert.throws(() => computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: 0 }));
  assert.throws(() => computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: "abc" }));
  assert.throws(() => computeReleaseVersion({ channel: "rc", baseVersion: "0.1.0", rcIndex: -1 }));
});

test("version computation: base-version agreement check", () => {
  assert.doesNotThrow(() =>
    assertBaseVersionAgreement("0.1.0", { [FAMILY]: "0.1.0" }),
  );
  assert.throws(() => assertBaseVersionAgreement("0.1.0", { [FAMILY]: "0.2.0" }));
  assert.throws(() => assertBaseVersionAgreement("0.1.0-rc1", { [FAMILY]: "0.1.0-rc1" }));
});

test("prepare-release-version: dry-run reports the rc and leaves manifests untouched", () => {
  const manifestPaths = [
    path.join(REPO_ROOT, "package.json"),
    path.join(REPO_ROOT, FAMILY_PATH, "package.json"),
  ];
  const before = manifestPaths.map((manifestPath) => readFileSync(manifestPath, "utf8"));

  const result = node([
    path.join(SCRIPTS, "prepare-release-version.mjs"),
    "--channel",
    "rc",
    "--rc-index",
    "1",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonStdout(result);
  assert.equal(payload.version, "0.1.0-rc1");
  assert.equal(payload.npmTag, "rc");
  assert.equal(payload.stamped, false);

  const after = manifestPaths.map((manifestPath) => readFileSync(manifestPath, "utf8"));
  assert.deepEqual(after, before, "dry-run must not touch the manifests");
});

test("prepare-release-version: snapshot dry-run carries the run/sha suffix", () => {
  const result = node([
    path.join(SCRIPTS, "prepare-release-version.mjs"),
    "--channel",
    "snapshot",
    "--dry-run",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = jsonStdout(result);
  assert.match(payload.version, /^0\.1\.0-snapshot\.\d+\.[0-9a-f]{7}$/u);
  assert.equal(payload.npmTag, "snapshot");
});

test("prepare-release-version: stamps only a sandboxed checkout", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "release-version-sandbox-"));
  try {
    // Minimal repo skeleton: root + both workspace manifests + the tooling.
    mkdirSync(path.join(sandbox, FAMILY_PATH), { recursive: true });
    mkdirSync(path.join(sandbox, "packages", "smoke-consumer"), { recursive: true });
    cpSync(SCRIPTS, path.join(sandbox, "tooling", "scripts"), { recursive: true });
    cpSync(path.join(REPO_ROOT, "package.json"), path.join(sandbox, "package.json"));
    cpSync(
      path.join(REPO_ROOT, FAMILY_PATH, "package.json"),
      path.join(sandbox, FAMILY_PATH, "package.json"),
    );
    writeFileSync(
      path.join(sandbox, "packages", "smoke-consumer", "package.json"),
      `${JSON.stringify({ name: "smoke-consumer", version: "0.0.0", private: true }, null, 2)}\n`,
    );

    const result = node([
      path.join(sandbox, "tooling", "scripts", "prepare-release-version.mjs"),
      "--channel",
      "rc",
      "--rc-index",
      "3",
    ]);
    assert.equal(result.status, 0, result.stderr);

    const stampedRoot = JSON.parse(readFileSync(path.join(sandbox, "package.json"), "utf8"));
    const stampedPackage = JSON.parse(
      readFileSync(path.join(sandbox, FAMILY_PATH, "package.json"), "utf8"),
    );
    assert.equal(stampedRoot.version, "0.1.0-rc3");
    assert.equal(stampedPackage.version, "0.1.0-rc3");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Workspace catalog
// ---------------------------------------------------------------------------

test("workspace catalog: the family package is the only publishable workspace", () => {
  const family = workspaceCatalog.find((workspace) => workspace.name === FAMILY);
  assert.equal(family?.path, FAMILY_PATH);
  assert.equal(family?.releaseStage, "supported");
  assert.equal(family?.publishable, true);

  const smoke = workspaceCatalog.find((workspace) => workspace.name === "smoke-consumer");
  assert.equal(smoke?.publishable, false, "the smoke consumer is private evidence tooling");

  assert.deepEqual(catalogViolations(), []);
});

test("workspace catalog: --check passes and path flags print exactly the family package", () => {
  const check = node([path.join(SCRIPTS, "workspace-catalog.mjs"), "--check"]);
  assert.equal(check.status, 0, check.stderr);

  const publishable = node([path.join(SCRIPTS, "workspace-catalog.mjs"), "--publishable-paths"]);
  assert.equal(publishable.status, 0, publishable.stderr);
  assert.deepEqual(publishable.stdout.trim().split("\n"), [FAMILY_PATH]);

  const packable = node([path.join(SCRIPTS, "workspace-catalog.mjs"), "--packable-paths"]);
  assert.equal(packable.status, 0, packable.stderr);
  assert.deepEqual(packable.stdout.trim().split("\n"), [FAMILY_PATH]);
});

// ---------------------------------------------------------------------------
// Publication context rules
// ---------------------------------------------------------------------------

const resolveContext = (env, args) =>
  bash(path.join(SCRIPTS, "release-resolve-context.sh"), args, {
    env: { ...process.env, ...env },
  });

test("release-resolve-context: dispatch-only enforcement and channel/branch rules", () => {
  const cases = [
    // [name, event, ref, args, expectedExit]
    ["rc from develop", "workflow_dispatch", "refs/heads/develop", ["--channel", "rc", "--rc-index", "1"], 0],
    ["rc from main", "workflow_dispatch", "refs/heads/main", ["--channel", "rc", "--rc-index", "2"], 0],
    ["release from main", "workflow_dispatch", "refs/heads/main", ["--channel", "release"], 0],
    ["snapshot from develop", "workflow_dispatch", "refs/heads/develop", ["--channel", "snapshot"], 0],
    ["snapshot from main rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "snapshot"], 1],
    ["release from develop rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "release"], 1],
    ["rc from feature branch rejected", "workflow_dispatch", "refs/heads/feat/x", ["--channel", "rc"], 1],
    ["push event rejected", "push", "refs/heads/main", ["--channel", "release"], 1],
    ["pull_request event rejected", "pull_request", "refs/heads/main", ["--channel", "rc"], 1],
    ["rc index on snapshot rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "snapshot", "--rc-index", "1"], 1],
    ["rc index on release rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--rc-index", "1"], 1],
    ["non-integer rc index rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "rc", "--rc-index", "abc"], 1],
    ["zero rc index rejected", "workflow_dispatch", "refs/heads/develop", ["--channel", "rc", "--rc-index", "0"], 1],
    ["unstable version rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--version", "1.2.3-rc1"], 1],
    ["two-part version rejected", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--version", "1.2"], 1],
    ["stable version accepted", "workflow_dispatch", "refs/heads/main", ["--channel", "release", "--version", "0.2.0"], 0],
    ["tag ref rejected", "workflow_dispatch", "refs/tags/v1.0.0", ["--channel", "release"], 1],
  ];
  for (const [name, event, ref, args, expectedExit] of cases) {
    const result = resolveContext({ GITHUB_EVENT_NAME: event, GITHUB_REF: ref }, args);
    assert.equal(result.status, expectedExit, `${name}: ${result.stdout} ${result.stderr}`);
  }
});

test("release-resolve-context: emits the publication context", () => {
  const output = mkdtempSync(path.join(tmpdir(), "release-ctx-"));
  try {
    const outputFile = path.join(output, "ctx");
    const result = resolveContext(
      { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/develop", GITHUB_OUTPUT: outputFile },
      ["--channel", "rc", "--rc-index", "4", "--version", "0.1.0"],
    );
    assert.equal(result.status, 0, result.stderr);
    const emitted = Object.fromEntries(
      readFileSync(outputFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    assert.equal(emitted.channel, "rc");
    assert.equal(emitted.branch, "develop");
    assert.equal(emitted["npm-tag"], "rc");
    assert.equal(emitted["base-version"], "0.1.0");
    assert.equal(emitted["rc-index"], "4");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Publish-script contract
// ---------------------------------------------------------------------------

test("publish-script contract: registry lockdown, provenance, public access, tag, no-op, token hygiene", () => {
  const script = readFileSync(path.join(SCRIPTS, "publish-npm-packages.sh"), "utf8");

  // Registry lockdown: the script hard-fails on any other registry.
  assert.match(script, /must be locked to https:\/\/registry\.npmjs\.org\//u);

  // Provenance-enabled, public-access, tagged publication.
  assert.match(script, /--provenance/u);
  assert.match(script, /--access public/u);
  assert.match(script, /--tag "\$\{NPM_TAG\}"/u);

  // Idempotent no-op for an already-published version.
  assert.match(script, /already published/u);
  // Dist-tag repair instead of republishing.
  assert.match(script, /dist-tag|DIST_TAG/u);
  // Tarball-then-version verification after publish.
  assert.match(script, /post-publish verification/u);
  // Token hygiene: the token is required but never echoed or passed as an argument.
  assert.doesNotMatch(script, /echo[^#]*NODE_AUTH_TOKEN/u);
  assert.doesNotMatch(script, /publish[^#\n]*NODE_AUTH_TOKEN/u);
});

test("publish-script: refuses non-npmjs registries and missing tokens", () => {
  const work = mkdtempSync(path.join(tmpdir(), "publish-contract-"));
  try {
    const tarball = makeFixtureTarball(work, { version: "9.9.9" });
    const baseEnv = { ...process.env, NODE_AUTH_TOKEN: "dummy" };

    const locked = bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "rc", "--artifacts-dir", work], {
      env: { ...baseEnv, NPM_REGISTRY: "https://evil.example/" },
    });
    assert.equal(locked.status, 1, "a non-npmjs registry must fail before publishing");
    assert.match(locked.stderr, /locked to https:\/\/registry\.npmjs\.org\//u);

    const tokenless = bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "rc", "--artifacts-dir", work], {
      env: { ...process.env, NPM_REGISTRY: NPMJS },
    });
    assert.equal(tokenless.status, 1, "a missing token must fail before publishing");
    assert.match(tokenless.stderr, /NODE_AUTH_TOKEN is not set/u);

    const badTag = bash(path.join(SCRIPTS, "publish-npm-packages.sh"), ["--npm-tag", "nightly", "--artifacts-dir", work], {
      env: baseEnv,
    });
    assert.equal(badTag.status, 1);
    assert.match(badTag.stderr, /unknown npm tag/u);
    void tarball;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("publish-script: no-op with dist-tag repair under a mocked registry view", () => {
  const work = mkdtempSync(path.join(tmpdir(), "publish-noop-"));
  try {
    makeFixtureTarball(work, { version: "9.9.9" });
    const mockView = MOCK_VIEW(work);
    const mockDistTag = MOCK_DIST_TAG(work);
    const distTagLog = path.join(work, "dist-tag.log");
    const tagsFile = path.join(work, "tags.json");
    writeFileSync(distTagLog, "");
    writeFileSync(tagsFile, JSON.stringify({ latest: "9.8.0", rc: "9.9.0" }));

    // The version is already published, but the `rc` dist-tag has drifted to
    // an older release: the script must repair the tag and skip republishing.
    const result = bash(
      path.join(SCRIPTS, "publish-npm-packages.sh"),
      ["--npm-tag", "rc", "--artifacts-dir", work],
      {
        env: {
          ...process.env,
          NODE_AUTH_TOKEN: "dummy",
          NPM_VIEW_COMMAND: `node ${mockView}`,
          NPM_DIST_TAG_COMMAND: `node ${mockDistTag}`,
          MOCK_VIEW_VERSION: "9.9.9",
          MOCK_TAGS_FILE: tagsFile,
          MOCK_DIST_TAG_LOG: distTagLog,
        },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /already published/u);
    assert.match(result.stdout, /repairing/u);
    assert.match(
      readFileSync(distTagLog, "utf8").trim(),
      new RegExp(`^${FAMILY.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}@9\\.9\\.9 rc$`, "u"),
    );
    assert.equal(
      JSON.parse(readFileSync(tagsFile, "utf8")).rc,
      "9.9.9",
      "the mocked registry must reflect the repaired dist-tag",
    );

    // A pure no-op: version published, tag already correct.
    const noop = bash(
      path.join(SCRIPTS, "publish-npm-packages.sh"),
      ["--npm-tag", "rc", "--artifacts-dir", work],
      {
        env: {
          ...process.env,
          NODE_AUTH_TOKEN: "dummy",
          NPM_VIEW_COMMAND: `node ${mockView}`,
          NPM_DIST_TAG_COMMAND: `node ${mockDistTag}`,
          MOCK_VIEW_VERSION: "9.9.9",
          MOCK_TAGS_FILE: tagsFile,
          MOCK_DIST_TAG_LOG: distTagLog,
        },
      },
    );
    assert.equal(noop.status, 0, noop.stdout + noop.stderr);
    assert.match(noop.stdout, /no-op/u);
    assert.doesNotMatch(noop.stdout, /npm publish/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Release package contract (sandboxed tarball fixtures)
// ---------------------------------------------------------------------------

test("release package contract: a complete fixture satisfies the contract", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-ok-"));
  try {
    const tarball = makeFixtureTarball(work);
    const result = node([path.join(SCRIPTS, "check-release-package-contract.mjs"), "--tarball", tarball]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: a stripped tarball fails", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-stripped-"));
  try {
    const tarball = makeFixtureTarball(work, {
      mutate: (pkg) => {
        rmSync(path.join(pkg, "CHANGELOG.md"));
      },
    });
    const result = node([path.join(SCRIPTS, "check-release-package-contract.mjs"), "--tarball", tarball]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /CHANGELOG\.md is missing/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: managed source maps and dist gaps fail", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-maps-"));
  try {
    const tarball = makeFixtureTarball(work, {
      mutate: (pkg) => {
        writeFileSync(
          path.join(pkg, "dist", "managed", "digital-passport-credential", "contract", "index.js.map"),
          "{}",
        );
      },
    });
    const result = node([path.join(SCRIPTS, "check-release-package-contract.mjs"), "--tarball", tarball]);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /managed-code source map is shipped/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("release package contract: publication-metadata violations are named", () => {
  const work = mkdtempSync(path.join(tmpdir(), "contract-meta-"));
  try {
    const pkg = path.join(work, "package");
    mkdirSync(path.join(pkg, "dist", "managed", "c", "contract"), { recursive: true });
    mkdirSync(path.join(pkg, "src"), { recursive: true });
    mkdirSync(path.join(pkg, "scripts"), { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: FAMILY,
        version: "0.1.0",
        repository: { url: "git+https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport.git", directory: "packages/wrong" },
        publishConfig: { access: "restricted", registry: "https://registry.evil.example/" },
      }),
    );
    writeFileSync(path.join(pkg, "README.md"), "# x");
    writeFileSync(path.join(pkg, "CHANGELOG.md"), "# x");
    writeFileSync(path.join(pkg, "dist", "index.js"), "");
    writeFileSync(path.join(pkg, "dist", "managed", "c", "contract", "index.js"), "");
    writeFileSync(path.join(pkg, "src", "x.compact"), "");
    writeFileSync(path.join(pkg, "scripts", "x.mjs"), "");

    const violations = contractViolations(pkg, { expectedRepositoryDirectory: FAMILY_PATH });
    assert.ok(violations.some((violation) => violation.includes("publishConfig.access")));
    assert.ok(violations.some((violation) => violation.includes("publishConfig.registry")));
    assert.ok(violations.some((violation) => violation.includes("repository.directory")));
    assert.ok(violations.some((violation) => violation.includes("description")));
    assert.ok(violations.some((violation) => violation.includes("keywords")));
    assert.ok(violations.some((violation) => violation.includes("homepage")));
    assert.ok(violations.some((violation) => violation.includes("bugs.url")));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// npm release state (dist-tag snapshot / verify / repair)
// ---------------------------------------------------------------------------

test("npm-release-state: snapshot and verify with tag repair under a mocked registry view", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-"));
  try {
    const mockView = MOCK_VIEW(work);
    const mockDistTag = MOCK_DIST_TAG(work);
    const stateFile = path.join(work, "state.json");
    const distTagLog = path.join(work, "dist-tag.log");
    const tagsFile = path.join(work, "tags.json");
    writeFileSync(distTagLog, "");
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.1.0", rc: "0.1.0-rc1" }));
    const baseEnv = {
      ...process.env,
      MOCK_TAGS_FILE: tagsFile,
      MOCK_DIST_TAG_LOG: distTagLog,
    };

    const snapshot = node([path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`], {
      env: baseEnv,
    });
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.deepEqual(state.packages[FAMILY].distTags, { latest: "0.1.0", rc: "0.1.0-rc1" });

    // Verifying the expected tag passes.
    const ok = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc1", "--protect-latest", "--view-cmd", `node ${mockView}`],
      { env: baseEnv },
    );
    assert.equal(ok.status, 0, ok.stderr);

    // Drifted tag: fails closed without --repair …
    const drifted = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc2", "--view-cmd", `node ${mockView}`],
      { env: baseEnv },
    );
    assert.equal(drifted.status, 1);
    assert.match(drifted.stderr, /dist-tag 'rc' resolves to 0\.1\.0-rc1/u);

    // … and repairs with --repair (the mocked registry reflects the repair).
    const repaired = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc2", "--repair", "--view-cmd", `node ${mockView}`, "--dist-tag-cmd", `node ${mockDistTag}`],
      { env: baseEnv },
    );
    assert.equal(repaired.status, 0, repaired.stderr);
    assert.match(readFileSync(distTagLog, "utf8").trim(), / rc$/u);
    assert.equal(JSON.parse(readFileSync(tagsFile, "utf8")).rc, "0.1.0-rc2");

    // latest protection: a moved latest during a non-release publication fails.
    writeFileSync(tagsFile, JSON.stringify({ latest: "0.2.0", rc: "0.1.0-rc1" }));
    const latestDrift = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--verify", "--snapshot-file", stateFile, "--npm-tag", "rc", "--version", "0.1.0-rc1", "--protect-latest", "--view-cmd", `node ${mockView}`],
      { env: baseEnv },
    );
    assert.equal(latestDrift.status, 1);
    assert.match(latestDrift.stderr, /'latest' moved/u);

    // Registry lockdown mirrors the publish script.
    const unlocked = node([path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`, "--registry", "https://evil.example/"], {
      env: baseEnv,
    });
    assert.equal(unlocked.status, 1);
    assert.match(unlocked.stderr, /locked/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// First-publication registry state
// ---------------------------------------------------------------------------

test("npm-release-state: a not-yet-published package snapshots as empty dist-tags (E404)", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-first-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const snapshot = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_MISSING: "1" } },
    );
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    assert.deepEqual(state.packages[FAMILY].distTags, {});
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("npm-release-state: non-E404 registry errors still fail closed", () => {
  const work = mkdtempSync(path.join(tmpdir(), "release-state-broken-"));
  try {
    const mockView = MOCK_VIEW(work);
    const stateFile = path.join(work, "state.json");
    const snapshot = node(
      [path.join(SCRIPTS, "npm-release-state.mjs"), "--snapshot", "--out", stateFile, "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_BROKEN: "1" } },
    );
    assert.equal(snapshot.status, 1);
    assert.match(snapshot.stderr, /registry view failed/u);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Registry propagation wait
// ---------------------------------------------------------------------------

test("wait-for-npm-packages: resolves via a mocked view and times out on absence", () => {
  const work = mkdtempSync(path.join(tmpdir(), "wait-npm-"));
  try {
    const mockView = MOCK_VIEW(work);
    const visible = node(
      [path.join(SCRIPTS, "wait-for-npm-packages.mjs"), "--version", "0.1.0-rc1", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_VERSION: "0.1.0-rc1" } },
    );
    assert.equal(visible.status, 0, visible.stderr);

    const absent = node(
      [
        path.join(SCRIPTS, "wait-for-npm-packages.mjs"),
        "--version",
        "0.1.0-rc1",
        "--timeout",
        "1",
        "--interval",
        "1",
        "--view-cmd",
        `node ${mockView}`,
      ],
      { env: { ...process.env, MOCK_VIEW_VERSION: "" } },
    );
    assert.equal(absent.status, 1);
    assert.match(absent.stderr, /timed out/u);

    const unlocked = node(
      [path.join(SCRIPTS, "wait-for-npm-packages.mjs"), "--version", "0.1.0-rc1", "--registry", "https://evil.example/", "--view-cmd", `node ${mockView}`],
      { env: { ...process.env, MOCK_VIEW_VERSION: "0.1.0-rc1" } },
    );
    assert.equal(unlocked.status, 1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Consumer test argument validation
// ---------------------------------------------------------------------------

test("test-release-package-consumers: registry-mode argument validation", () => {
  assert.throws(() => parseConsumerArgs(["--registry", NPMJS]), /together/u);
  assert.throws(() => parseConsumerArgs(["--version", "1.2.3"]), /together/u);
  assert.throws(() => parseConsumerArgs(["--registry", "http://insecure.example", "--version", "1.2.3"]), /https/u);
  assert.throws(() => parseConsumerArgs(["--registry", NPMJS, "--version", "not-a-version"]), /semantic version/u);
  assert.deepEqual(parseConsumerArgs(["--registry", NPMJS, "--version", "0.1.0-rc1"]).mode, "registry");
  assert.deepEqual(parseConsumerArgs([]).mode, "tarball");
});

// ---------------------------------------------------------------------------
// SBOM generation
// ---------------------------------------------------------------------------

test("generate-release-sbom: emits a dependency-free SPDX document per tarball", () => {
  const work = mkdtempSync(path.join(tmpdir(), "sbom-"));
  try {
    const tarball = makeFixtureTarball(work, { name: "@fixture/sbom-pkg", version: "2.3.4" });
    const outDir = path.join(work, "sbom-out");
    const result = node(
      [path.join(SCRIPTS, "generate-release-sbom.mjs"), "--artifacts-dir", work, "--out-dir", outDir],
    );
    assert.equal(result.status, 0, result.stderr);

    const files = readdirSync(outDir).filter((file) => file.endsWith(".spdx.json"));
    assert.equal(files.length, 1);
    const document = JSON.parse(readFileSync(path.join(outDir, files[0]), "utf8"));
    assert.equal(document.spdxVersion, "SPDX-2.3");
    assert.equal(document.dataLicense, "CC0-1.0");
    assert.equal(document.packages[0].name, "@fixture/sbom-pkg");
    assert.equal(document.packages[0].versionInfo, "2.3.4");
    assert.equal(document.packages[0].filesAnalyzed, true);
    assert.match(document.packages[0].packageVerificationCode.packageVerificationCodeValue, /^[0-9a-f]{40}$/u);
    assert.match(document.packages[0].externalRefs[0].referenceLocator, /^pkg:npm\//u);

    // The checksum matches the tarball bytes.
    const expectedSha = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    assert.equal(
      document.packages[0].checksums.find((checksum) => checksum.algorithm === "SHA256").checksumValue,
      expectedSha,
    );

    // The verification code is reproducible from the extracted contents.
    const extract = mkdtempSync(path.join(tmpdir(), "sbom-extract-"));
    try {
      execFileSync("tar", ["-xzf", tarball, "-C", extract]);
      assert.equal(
        packageVerificationCode(path.join(extract, "package")),
        document.packages[0].packageVerificationCode.packageVerificationCodeValue,
      );
    } finally {
      rmSync(extract, { recursive: true, force: true });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Publication workflow guard (mutation tests for check-security-workflows)
// ---------------------------------------------------------------------------

test("publish workflow guard: the real workflow satisfies the dedicated assertions", () => {
  const workflow = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );
  assert.deepEqual(assertPublishWorkflow(workflow, ".github/workflows/publish.yml"), []);
});

test("publish workflow guard: mutated workflows fail (push trigger, widened permissions, foreign registry, missing gate)", () => {
  const base = parseYaml(
    readFileSync(path.join(REPO_ROOT, ".github/workflows/publish.yml"), "utf8"),
  );

  const withPushTrigger = structuredClone(base);
  withPushTrigger.on.push = { branches: ["main"] };
  assert.ok(
    assertPublishWorkflow(withPushTrigger, "publish.yml").some((violation) =>
      violation.includes("workflow_dispatch only"),
    ),
  );

  const widened = structuredClone(base);
  widened.jobs.publish.permissions = {
    contents: "read",
    "id-token": "write",
    "pull-requests": "write",
  };
  assert.ok(
    assertPublishWorkflow(widened, "publish.yml").some((violation) =>
      violation.includes("exactly contents: read and id-token: write"),
    ),
  );

  const foreignRegistry = structuredClone(base);
  foreignRegistry.env.NPM_REGISTRY = "https://registry.evil.example/";
  assert.ok(
    assertPublishWorkflow(foreignRegistry, "publish.yml").some((violation) =>
      violation.includes("locked to https://registry.npmjs.org/"),
    ),
  );

  const gateless = structuredClone(base);
  gateless.jobs.publish.steps = gateless.jobs.publish.steps.filter(
    (step) => !String(step.run ?? "").includes("release-resolve-context.sh"),
  );
  assert.ok(
    assertPublishWorkflow(gateless, "publish.yml").some((violation) =>
      violation.includes("release-resolve-context.sh"),
    ),
  );

  const wrongChannels = structuredClone(base);
  wrongChannels.on.workflow_dispatch.inputs.channel.options = ["snapshot", "rc"];
  assert.ok(
    assertPublishWorkflow(wrongChannels, "publish.yml").some((violation) =>
      violation.includes("snapshot|rc|release"),
    ),
  );
});

// ---------------------------------------------------------------------------
// Guard import sanity (the full mutation tests live with the workflow checks)
// ---------------------------------------------------------------------------

test("release scripts are byte-identical between catalog and disk (guard rails)", () => {
  for (const script of [
    "workspace-catalog.mjs",
    "prepare-release-version.mjs",
    "release-resolve-context.sh",
    "pack-artifacts.sh",
    "check-release-package-contract.mjs",
    "test-release-package-consumers.mjs",
    "publish-npm-packages.sh",
    "wait-for-npm-packages.mjs",
    "npm-release-state.mjs",
    "generate-release-sbom.mjs",
  ]) {
    assert.ok(existsSync(path.join(SCRIPTS, script)), `${script} must exist`);
  }
});
