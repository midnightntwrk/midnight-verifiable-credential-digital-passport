#!/usr/bin/env node
// Supply-chain install-policy guard (TASK-1 follow-up).
//
// Why this exists: pnpm 10 does NOT validate the policy settings in
// pnpm-workspace.yaml. A misspelled key (e.g. `trustPoliy`) or an invalid
// value (e.g. `trustPolicy: bogus-value`) is silently ignored and
// `pnpm install --frozen-lockfile` still exits 0 (verified on pnpm 10.34.1),
// leaving the supply-chain guard inert. This script fails closed instead:
//
//   1. Statically validates the policy keys and exact values in
//      pnpm-workspace.yaml (catches typos in key names and values).
//   2. Cross-checks every value through `pnpm config get --json`, proving
//      that pnpm actually parses the settings (catches a removed/renamed
//      setting and any value masked or injected from another config layer).
//   3. Validates the .npmrc min-release-age setting.
//
// Run via `pnpm run verify:install-policy` (chained into `pnpm run all`, so it
// runs in the CI verify lane) or directly with node.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL ${message}`);
};
const pass = (message) => console.log(`PASS ${message}`);

// Parse YAML with a real parser (js-yaml) instead of hand-rolled line
// matching: comments (including trailing inline ones), quoting, and flow vs
// block sequences must resolve exactly the way a YAML implementation reads
// them, or this guard would false-fail (or false-pass) on valid config.
let loadYaml;
let yamlSchema;
try {
  ({ load: loadYaml, CORE_SCHEMA: yamlSchema } = await import('js-yaml'));
} catch (error) {
  fail(`cannot load the js-yaml parser (run "pnpm install" first): ${error.message}`);
}

// The supply-chain install policy this repository mandates. Expected values
// are intentional and exhaustive, including for the build-script allowlist: a
// policy change must update this file in the same commit, so it can never
// drift silently.
const EXPECTED_POLICY = [
  { key: 'blockExoticSubdeps', type: 'boolean', value: true },
  { key: 'minimumReleaseAge', type: 'number', value: 10080 },
  { key: 'trustPolicy', type: 'string', value: 'no-downgrade' },
  { key: 'minimumReleaseAgeExclude', type: 'array', value: [] },
  { key: 'trustPolicyExclude', type: 'array', value: [] },
  // ignoredBuiltDependencies is itself security-relevant policy: pnpm
  // silently skips the build scripts of anything listed here. Its exact
  // content is pinned, so adding a package to (or dropping one from) the
  // allowlist fails this guard until the expectation is updated in the same,
  // reviewable commit. Order is not meaningful to pnpm, so entries are
  // compared as sets, not sequences.
  { key: 'ignoredBuiltDependencies', type: 'array', value: ['esbuild', 'unrs-resolver'] },
];
const EXPECTED_NPMRC = new Map([['min-release-age', '7']]);

/**
 * Parse pnpm-workspace.yaml into a plain object mapping its top-level keys to
 * their values. Scalars, sequences, and nested structures come back exactly
 * as the YAML parser reads them. Anything that is not a top-level mapping
 * throws, so the guard fails closed on surprises.
 */
function readWorkspacePolicy(file) {
  const doc = loadYaml(readFileSync(file, 'utf8'), { schema: yamlSchema });
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`${file}: expected a top-level YAML mapping`);
  }
  return doc;
}

/** Resolve a callable pnpm command line, preferring the running pnpm itself. */
function resolvePnpm() {
  const candidates = [];
  const execPath = process.env.npm_execpath;
  if (execPath) {
    if (/\.c?m?js$/i.test(execPath)) candidates.push([process.execPath, execPath]);
    else candidates.push([execPath]);
  }
  candidates.push(['pnpm']);
  candidates.push(['corepack', 'pnpm']);
  for (const [file, ...prefix] of candidates) {
    try {
      execFileSync(file, [...prefix, '--version'], { stdio: 'ignore' });
      return (args) =>
        execFileSync(file, [...prefix, ...args], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('cannot invoke pnpm (tried npm_execpath, pnpm, corepack pnpm)');
}

function pnpmConfigGetJson(key) {
  const stdout = pnpmRun(['config', 'get', '--json', key]).trim();
  if (stdout === '' || stdout === 'undefined') return undefined;
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `pnpm config get --json ${key} returned non-JSON output "${stdout}" (${error.message})`,
    );
  }
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Same set of entries, order-insensitive (catches adds, drops, duplicates). */
const sameSet = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

let pnpmRun;
try {
  pnpmRun = resolvePnpm();
} catch (error) {
  fail(error.message);
}

if (pnpmRun && loadYaml) {
  const workspaceFile = join(repoRoot, 'pnpm-workspace.yaml');
  let workspace;
  try {
    workspace = readWorkspacePolicy(workspaceFile);
  } catch (error) {
    fail(error.message);
    workspace = null;
  }

  for (const expectation of EXPECTED_POLICY) {
    const { key, value: expected } = expectation;
    if (!workspace || !Object.hasOwn(workspace, key)) {
      fail(
        `pnpm-workspace.yaml: missing top-level key "${key}" — pnpm silently ` +
          `ignores misspelled keys, so a typo here would disable the install ` +
          `policy without failing "pnpm install --frozen-lockfile"`,
      );
      continue;
    }

    const staticValue = workspace[key];
    const staticOk =
      expectation.type === 'array'
        ? sameSet(staticValue, expected) && staticValue.every((v) => typeof v === 'string')
        : typeof staticValue === expectation.type && Object.is(staticValue, expected);
    if (staticOk) {
      pass(`pnpm-workspace.yaml: ${key} = ${JSON.stringify(staticValue)} (exact policy value)`);
    } else {
      fail(
        `pnpm-workspace.yaml: ${key} is ${JSON.stringify(staticValue)}, expected ` +
          `${JSON.stringify(expected)} (${expectation.type})`,
      );
    }

    // Cross-check through pnpm itself: this is what proves pnpm parses the
    // setting instead of silently ignoring a misspelled/unknown key.
    let liveValue;
    try {
      liveValue = pnpmConfigGetJson(key);
    } catch (error) {
      fail(`pnpm config get ${key}: ${error.message}`);
      continue;
    }
    if (liveValue === undefined) {
      fail(
        `pnpm config get ${key} -> undefined: pnpm does not see this setting ` +
          `(misspelled key, unsupported pnpm version, or masked by another ` +
          `config layer) — the install policy would be silently inert`,
      );
    } else if (!deepEqual(liveValue, staticValue)) {
      fail(
        `pnpm config get ${key} -> ${JSON.stringify(liveValue)} but ` +
          `pnpm-workspace.yaml declares ${JSON.stringify(staticValue)}`,
      );
    } else {
      pass(`pnpm config get ${key} -> ${JSON.stringify(liveValue)} (pnpm parses the setting)`);
    }
  }

  // .npmrc: the npm-side release-age floor (AC4 of the hardening task).
  const npmrcFile = join(repoRoot, '.npmrc');
  const npmrc = new Map();
  for (const line of readFileSync(npmrcFile, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*([^\s#=]+)\s*=\s*(.*)$/);
    if (!match) {
      fail(`.npmrc: cannot parse line "${line}"`);
      continue;
    }
    npmrc.set(match[1], match[2].trim());
  }
  for (const [key, value] of EXPECTED_NPMRC) {
    if (npmrc.get(key) === value) {
      pass(`.npmrc: ${key}=${value}`);
    } else {
      fail(`.npmrc: ${key}=${JSON.stringify(npmrc.get(key))}, expected "${value}"`);
    }
  }
}

if (failures.length > 0) {
  console.error(`\nInstall-policy guard: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log('\nInstall-policy guard: PASS');
