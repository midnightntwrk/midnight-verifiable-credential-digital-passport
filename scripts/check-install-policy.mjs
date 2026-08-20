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

// The supply-chain install policy this repository mandates. Expected values
// are intentional: a policy change must update this file in the same commit,
// so it can never drift silently.
const EXPECTED_POLICY = [
  { key: 'blockExoticSubdeps', type: 'boolean', value: true },
  { key: 'minimumReleaseAge', type: 'number', value: 10080 },
  { key: 'trustPolicy', type: 'string', value: 'no-downgrade' },
  { key: 'minimumReleaseAgeExclude', type: 'array', empty: true },
  { key: 'trustPolicyExclude', type: 'array', empty: true },
  { key: 'ignoredBuiltDependencies', type: 'array' },
];
const EXPECTED_NPMRC = new Map([['min-release-age', '7']]);

const unquote = (value) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const toScalar = (raw) => {
  const value = unquote(raw);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
};

/**
 * Extract the top-level keys of a (small, flat) YAML document with their
 * normalized values: scalars stay scalars, `[]` / `- item` blocks become
 * arrays. Only the requested keys are normalized; other top-level keys are
 * recorded as present but left unparsed. Anything that cannot be understood
 * throws, so the guard fails closed on surprises.
 */
function readTopLevelYaml(file, keysToNormalize) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const topKeys = new Set();
  const blocks = new Map(); // key -> { inline, body: [] }
  let current = null;

  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const isTopLevel = /^[^\s#][^\s]*:/.test(line);
    if (isTopLevel) {
      const separator = line.indexOf(':');
      const key = line.slice(0, separator).trim();
      current = key;
      topKeys.add(key);
      blocks.set(key, { inline: line.slice(separator + 1).trim(), body: [] });
    } else {
      if (current === null) {
        throw new Error(`${file}: cannot parse line outside any key: "${line}"`);
      }
      blocks.get(current).body.push(line);
    }
  }

  const normalized = new Map();
  for (const key of keysToNormalize) {
    if (!topKeys.has(key)) continue;
    const { inline, body } = blocks.get(key);
    if (inline !== '') {
      if (inline.startsWith('[')) {
        const inner = inline.replace(/^\[/, '').replace(/\]$/, '').trim();
        normalized.set(key, inner === '' ? [] : inner.split(',').map(unquote));
      } else {
        normalized.set(key, toScalar(inline));
      }
      continue;
    }
    const items = [];
    for (const line of body) {
      const item = line.trim();
      if (item.startsWith('- ')) {
        items.push(toScalar(item.slice(2)));
      } else if (/^[^\s#-][^\s]*:/.test(item)) {
        throw new Error(
          `${file}: policy key "${key}" has an unexpected nested mapping; expected a scalar or list`,
        );
      } else {
        throw new Error(`${file}: cannot parse line under "${key}": "${line}"`);
      }
    }
    normalized.set(key, items);
  }
  return { topKeys, normalized };
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
    throw new Error(`pnpm config get --json ${key} returned non-JSON output "${stdout}" (${error.message})`);
  }
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let pnpmRun;
try {
  pnpmRun = resolvePnpm();
} catch (error) {
  fail(error.message);
}

if (pnpmRun) {
  const workspaceFile = join(repoRoot, 'pnpm-workspace.yaml');
  let workspace;
  try {
    workspace = readTopLevelYaml(
      workspaceFile,
      EXPECTED_POLICY.map(({ key }) => key),
    );
  } catch (error) {
    fail(error.message);
    workspace = null;
  }

  for (const expectation of EXPECTED_POLICY) {
    const { key } = expectation;
    if (!workspace || !workspace.topKeys.has(key)) {
      fail(
        `pnpm-workspace.yaml: missing top-level key "${key}" — pnpm silently ` +
          `ignores misspelled keys, so a typo here would disable the install ` +
          `policy without failing "pnpm install --frozen-lockfile"`,
      );
      continue;
    }

    const staticValue = workspace.normalized.get(key);
    const expected =
      'value' in expectation
        ? expectation.value
        : expectation.empty
          ? []
          : undefined;

    let staticOk = true;
    if (expectation.type === 'array') {
      staticOk = Array.isArray(staticValue) && staticValue.every((v) => typeof v === 'string');
      if (staticOk && 'empty' in expectation) staticOk = staticValue.length === 0;
    } else if (typeof staticValue !== expectation.type || !Object.is(staticValue, expected)) {
      staticOk = false;
    }
    if (staticOk) {
      pass(
        `pnpm-workspace.yaml: ${key} = ${JSON.stringify(staticValue)}` +
          (expected === undefined ? '' : ` (exact policy value)`),
      );
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
