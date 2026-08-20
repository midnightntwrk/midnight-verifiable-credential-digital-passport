#!/usr/bin/env node
// Supply-chain lockfile gate (TASK-1 follow-up, review round 4).
//
// Why this exists: the install policy in pnpm-workspace.yaml
// (minimumReleaseAge, trustPolicy: no-downgrade, blockExoticSubdeps) is
// enforced by pnpm's DEPENDENCY RESOLVER — the step that picks versions from
// the registry. Every install this repository actually runs in CI and tooling
// uses `--frozen-lockfile` (.github/actions/setup-node-pnpm/action.yml,
// nix/npm-tarball.nix), which SKIPS resolution ("Lockfile is up to date,
// resolution step is skipped") and therefore never applies those checks: a
// malicious or minutes-old version merged into pnpm-lock.yaml would be
// installed silently. Empirically re-verified on pnpm 10.34.1: with
// minimumReleaseAge: 999999999, `pnpm install --frozen-lockfile` exits 0 while
// a non-frozen `pnpm install --lockfile-only` fails with
// NO_MATURE_MATCHING_VERSION.
//
// This gate closes that gap. It enforces the exact policy declared in
// pnpm-workspace.yaml against the exact artifact CI installs
// (pnpm-lock.yaml), using the same registry data and the same rules pnpm's
// resolver uses (pnpm 10.34.1, npm-resolver pickPackageFromMeta /
// filterPkgMetadataByPublishDate / trustChecks.failIfTrustDowngraded):
//
//   minimumReleaseAge      — every version locked in pnpm-lock.yaml must have
//                            been published at least N minutes ago, unless its
//                            package matches minimumReleaseAgeExclude.
//   trustPolicy            — with "no-downgrade", no locked version may have
//                            weaker trust evidence (trusted publisher >
//                            provenance > none) than the strongest evidence of
//                            any earlier-published version of that package,
//                            unless matched by trustPolicyExclude.
//   blockExoticSubdeps     — no exotic (non-registry: git, tarball URL, local
//                            directory) subdependency may be locked; only
//                            direct workspace dependencies may be exotic.
//
// The check fails closed: if a package's registry metadata cannot be fetched,
// or lacks the "time" field for a locked version, the gate fails instead of
// guessing (mirroring pnpm's own strict behavior when minimumReleaseAge is
// set: ERR_PNPM_MISSING_TIME).
//
// Run via `pnpm run verify:lockfile-supply-chain` (chained into `pnpm run all`
// and the CI supply-chain lane) or directly with node. Requires network
// access to the npm registry; responses are cached under
// node_modules/.cache/supply-chain-gate/ and revalidated with ETags so repeat
// runs are cheap and still authoritative.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`FAIL ${message}`);
};
const pass = (message) => console.log(`PASS ${message}`);

let loadYaml;
let yamlSchema;
try {
  ({ load: loadYaml, CORE_SCHEMA: yamlSchema } = await import('js-yaml'));
} catch (error) {
  fail(`cannot load the js-yaml parser (run "pnpm install" first): ${error.message}`);
}

// ---------------------------------------------------------------------------
// Policy: read from pnpm-workspace.yaml (the single source of truth — the same
// file `pnpm config get` reads), never duplicated here.
// ---------------------------------------------------------------------------

function readYaml(file) {
  const doc = loadYaml(readFileSync(file, 'utf8'), { schema: yamlSchema });
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error(`${file}: expected a top-level YAML mapping`);
  }
  return doc;
}

/** Mirrors @pnpm/matcher: exact match, or anchored wildcard where * is .*. */
function matcherFromPattern(pattern) {
  if (pattern === '*') return () => true;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
  if (escaped === pattern) return (input) => input === pattern;
  const regexp = new RegExp(`^${escaped}$`);
  return (input) => regexp.test(input);
}

/** Mirrors pnpm's parseVersionPolicyRule: "name", "name@1.2.3", "name@1.0.0||1.0.1". */
function parseVersionPolicyRule(pattern) {
  if (typeof pattern !== 'string') throw new Error(`non-string policy pattern ${JSON.stringify(pattern)}`);
  const isScoped = pattern.startsWith('@');
  const atIndex = isScoped ? pattern.indexOf('@', 1) : pattern.indexOf('@');
  if (atIndex === -1) return { packageName: pattern, exactVersions: [] };
  const packageName = pattern.slice(0, atIndex);
  const versionsPart = pattern.slice(atIndex + 1);
  const exactVersions = versionsPart.split('||');
  if (exactVersions.length === 0 || exactVersions.some((v) => !/^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/.test(v))) {
    throw new Error(`invalid versions union in policy pattern "${pattern}" (exact versions only)`);
  }
  return { packageName, exactVersions };
}

/**
 * Mirrors pnpm's createPackageVersionPolicy: returns true (whole package
 * exempt) or the list of trusted exact versions for the first matching name
 * pattern, or false.
 */
function createPackageVersionPolicy(patterns) {
  const rules = patterns.map((pattern) => {
    const parsed = parseVersionPolicyRule(pattern);
    return { nameMatcher: matcherFromPattern(parsed.packageName), exactVersions: parsed.exactVersions };
  });
  return (pkgName) => {
    for (const { nameMatcher, exactVersions } of rules) {
      if (!nameMatcher(pkgName)) continue;
      if (exactVersions.length === 0) return true;
      return exactVersions;
    }
    return false;
  };
}

const policyExempt = (policy, name, version) => {
  const result = policy(name);
  return result === true || (Array.isArray(result) && result.includes(version));
};

// ---------------------------------------------------------------------------
// Lockfile parsing (lockfileVersion 9)
// ---------------------------------------------------------------------------

/**
 * Parse a lockfile "packages" key ("name@version", possibly "npm:alias")
 * into { name, version } or null when it is not a registry package key.
 */
function parseLockfileKey(key) {
  const bare = key.replace(/\(.*\)$/, ''); // strip peer-dependency suffix
  const match = bare.match(/^(?:@([^@/]+)\/([^@]+)|([^@]+))@(.+)$/);
  if (!match) return null;
  const name = match[1] !== undefined ? `@${match[1]}/${match[2]}` : match[3];
  let version = match[4];
  if (version.startsWith('npm:')) {
    // alias dependency: the lockfile pins the real name@version behind it
    const aliased = version.slice(4);
    const at = aliased.lastIndexOf('@');
    if (at > 0) return { name: aliased.slice(0, at), version: aliased.slice(at + 1) };
  }
  return { name, version };
}

const isRegistryVersion = (version) => /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/.test(version);

// ---------------------------------------------------------------------------
// Registry metadata (full packuments: the abbreviated form omits "time")
// ---------------------------------------------------------------------------

const registry =
  process.env.npm_config_registry ||
  process.env.NPM_CONFIG_REGISTRY ||
  'https://registry.npmjs.org/';

const cacheDir = join(
  repoRoot,
  'node_modules',
  '.cache',
  'supply-chain-gate',
  new URL(registry).host.replace(/[^a-z0-9.-]/gi, '_'),
);

/** Per-version trust evidence, mirroring pnpm's getTrustEvidence. */
function trustEvidenceOf(manifest) {
  if (manifest?._npmUser?.trustedPublisher) return 'trustedPublisher';
  if (manifest?.dist?.attestations?.provenance) return 'provenance';
  return null;
}

const TRUST_RANK = { trustedPublisher: 2, provenance: 1 };

async function fetchWithRetry(url, init, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

let bytesDownloaded = 0;

/**
 * Fetch the authoritative publish times and trust evidence for one package,
 * served from a local cache when the registry answers 304 Not Modified.
 */
async function loadPackument(name) {
  const cacheFile = join(cacheDir, `${name.replace(/\//g, '__')}.json`);
  let cached;
  try {
    cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    cached = null;
  }
  const headers = { accept: 'application/json' };
  if (cached?.etag) headers['if-none-match'] = cached.etag;
  const response = await fetchWithRetry(new URL(name, registry).toString(), { headers });
  if (response.status === 304 && cached) {
    return { time: cached.time, trust: cached.trust };
  }
  if (response.status === 404) {
    throw new Error(`registry returned 404 for ${name} (unpublished? private registry not configured?)`);
  }
  if (!response.ok) {
    throw new Error(`registry returned HTTP ${response.status} for ${name}`);
  }
  const body = await response.text();
  bytesDownloaded += body.length;
  let doc;
  try {
    doc = JSON.parse(body);
  } catch (error) {
    throw new Error(`registry returned non-JSON metadata for ${name}: ${error.message}`);
  }
  const time = doc.time ?? null;
  const trust = {};
  for (const [version, manifest] of Object.entries(doc.versions ?? {})) {
    trust[version] = trustEvidenceOf(manifest);
  }
  const slim = { etag: response.headers.get('etag'), time, trust };
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(slim));
  } catch {
    // The cache is an optimization, never a correctness requirement.
  }
  return { time, trust };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function runWithConcurrency(limit, items, worker) {
  return Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async (_, slot) => {
      for (let i = slot; i < items.length; i += limit) await worker(items[i]);
    }),
  );
}

async function main() {
  const policyDoc = readYaml(join(repoRoot, 'pnpm-workspace.yaml'));
  const lockDoc = readYaml(join(repoRoot, 'pnpm-lock.yaml'));

  const minimumReleaseAge = policyDoc.minimumReleaseAge;
  const minimumReleaseAgeExclude = policyDoc.minimumReleaseAgeExclude ?? [];
  const trustPolicy = policyDoc.trustPolicy ?? 'off';
  const trustPolicyExclude = policyDoc.trustPolicyExclude ?? [];
  const blockExoticSubdeps = policyDoc.blockExoticSubdeps === true;

  const agePolicy = Array.isArray(minimumReleaseAgeExclude)
    ? createPackageVersionPolicy(minimumReleaseAgeExclude)
    : null;
  const trustExclusions = Array.isArray(trustPolicyExclude)
    ? createPackageVersionPolicy(trustPolicyExclude)
    : null;

  // Names declared as direct dependencies of any workspace importer: pnpm's
  // blockExoticSubdeps only restricts subdependencies, so direct (root-level)
  // exotic dependencies stay an explicit, reviewable package.json decision.
  const directDepNames = new Set();
  for (const importer of Object.values(lockDoc.importers ?? {})) {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const depName of Object.keys(importer[section] ?? {})) directDepNames.add(depName);
    }
  }

  // Collect every locked registry package (workspace "link:" packages are not
  // in the packages section and are local by construction).
  const locked = new Map(); // "name@version" -> { name, version, resolution }
  const exotic = new Map();
  for (const [key, entry] of Object.entries(lockDoc.packages ?? {})) {
    const parsed = parseLockfileKey(key);
    if (!parsed) {
      exotic.set(key, { reason: `unparseable lockfile key`, resolution: entry?.resolution ?? {} });
      continue;
    }
    const resolution = entry?.resolution ?? {};
    const registryResolved = isRegistryVersion(parsed.version) && !resolution.tarball && !resolution.commit && !resolution.directory && resolution.type !== 'directory';
    if (registryResolved) {
      locked.set(`${parsed.name}@${parsed.version}`, parsed);
    } else if (directDepNames.has(parsed.name)) {
      // direct exotic dependency: allowed by pnpm, but keep it visible
      exotic.set(key, { reason: 'exotic direct dependency (allowed)', resolution, direct: true });
    } else {
      exotic.set(key, { reason: 'exotic subdependency', resolution });
    }
  }

  // --- blockExoticSubdeps: checked purely from the lockfile -----------------
  if (blockExoticSubdeps) {
    const blocked = [...exotic.values()].filter((e) => !e.direct);
    if (blocked.length === 0) {
      pass(`blockExoticSubdeps: no exotic (non-registry) subdependencies locked`);
    } else {
      for (const entry of blocked) {
        fail(
          `blockExoticSubdeps: exotic subdependency locked: ${JSON.stringify(entry.resolution)} — ` +
            `a frozen install would accept it because resolution is skipped; ` +
            `move it to a direct dependency or vendor it explicitly`,
        );
      }
    }
  } else {
    pass('blockExoticSubdeps: disabled by policy (nothing to check)');
  }

  // --- minimumReleaseAge + trustPolicy: verified against the registry -------
  const checksAge = Number.isFinite(minimumReleaseAge) && minimumReleaseAge > 0;
  const checksTrust = trustPolicy === 'no-downgrade';
  if (!checksAge && !checksTrust) {
    pass('no release-age or trust policy enabled in pnpm-workspace.yaml (nothing to verify)');
    return;
  }

  const byName = new Map();
  for (const { name, version } of locked.values()) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(version);
  }

  const now = Date.now();
  let ageChecked = 0;
  let ageSkipped = 0;
  let trustChecked = 0;
  let trustSkipped = 0;
  const fetchErrors = [];

  await runWithConcurrency(8, [...byName.keys()], async (name) => {
    let packument;
    try {
      packument = await loadPackument(name);
    } catch (error) {
      fetchErrors.push(`${name}: ${error.message}`);
      return;
    }
    const { time, trust } = packument;
    for (const version of byName.get(name)) {
      const publishedAtRaw = time ? time[version] : undefined;
      if (checksAge && agePolicy && policyExempt(agePolicy, name, version)) {
        ageSkipped += 1;
      } else if (checksAge) {
        ageChecked += 1;
        if (!publishedAtRaw) {
          fail(
            `minimumReleaseAge: ${name}@${version} has no publish time in registry metadata — ` +
              `cannot prove it meets the ${minimumReleaseAge}-minute floor (pnpm fails the same way: ` +
              `ERR_PNPM_MISSING_TIME / NO_MATURE_MATCHING_VERSION)`,
          );
        } else {
          const publishedAt = new Date(publishedAtRaw);
          const ageMinutes = (now - publishedAt.getTime()) / 60_000;
          if (ageMinutes < minimumReleaseAge) {
            fail(
              `minimumReleaseAge: ${name}@${version} was published ${publishedAtRaw} ` +
                `(${(ageMinutes / 1440).toFixed(1)} days ago), younger than the ` +
                `${minimumReleaseAge}-minute (${(minimumReleaseAge / 1440).toFixed(0)}-day) floor — ` +
                `a frozen install would accept it silently; add it to minimumReleaseAgeExclude only ` +
                `with an explicit, reviewed reason`,
            );
          }
        }
      }
      if (checksTrust && trustExclusions && policyExempt(trustExclusions, name, version)) {
        trustSkipped += 1;
        continue;
      }
      if (checksTrust) {
        trustChecked += 1;
        if (!publishedAtRaw) {
          fail(
            `trustPolicy=no-downgrade: ${name}@${version} has no publish time in registry metadata — ` +
              `cannot verify its trust evidence (pnpm fails the same way)`,
          );
          continue;
        }
        const targetDate = new Date(publishedAtRaw);
        // Mirror detectStrongestTrustEvidenceBeforeDate: strongest evidence
        // among earlier-published versions (prereleases excluded unless the
        // target itself is a prerelease).
        const isPrerelease = (v) => /^\d+\.\d+\.\d+-/.test(v);
        let strongestPrior = null;
        for (const [otherVersion, otherPublishedAt] of Object.entries(time)) {
          if (!/^\d/.test(otherVersion)) continue; // "created"/"modified"/"unpublished"
          if (!isPrerelease(version) && isPrerelease(otherVersion)) continue;
          const otherDate = new Date(otherPublishedAt);
          if (!(otherDate < targetDate)) continue;
          const evidence = trust[otherVersion] ?? null;
          if (evidence === 'trustedPublisher') {
            strongestPrior = 'trustedPublisher';
            break;
          }
          if (evidence === 'provenance') strongestPrior = strongestPrior ?? 'provenance';
        }
        const currentEvidence = trust[version] ?? null;
        if (
          strongestPrior !== null &&
          (currentEvidence === null || TRUST_RANK[strongestPrior] > TRUST_RANK[currentEvidence])
        ) {
          fail(
            `trustPolicy=no-downgrade: ${name}@${version} has weaker trust evidence ` +
              `(${currentEvidence ?? 'none'}) than an earlier-published version ` +
              `(${strongestPrior}) — possible package takeover; pnpm's resolver would reject it`,
          );
        }
      }
    }
  });

  if (fetchErrors.length > 0) {
    for (const error of fetchErrors.slice(0, 20)) {
      fail(`registry metadata unavailable (fail closed): ${error}`);
    }
    if (fetchErrors.length > 20) fail(`registry metadata unavailable: …and ${fetchErrors.length - 20} more`);
  }

  if (checksAge) {
    pass(
      `minimumReleaseAge=${minimumReleaseAge}: ${ageChecked} locked versions verified ` +
        `(${ageSkipped} excluded by minimumReleaseAgeExclude)`,
    );
  }
  if (checksTrust) {
    pass(
      `trustPolicy=${trustPolicy}: ${trustChecked} locked versions verified ` +
        `(${trustSkipped} excluded by trustPolicyExclude)`,
    );
  }
  console.log(
    `INFO registry ${registry}: ${byName.size} packuments, ` +
      `${(bytesDownloaded / 1_048_576).toFixed(1)} MiB downloaded (ETag-cached under ${join('node_modules', '.cache', 'supply-chain-gate')})`,
  );
}

if (loadYaml) {
  try {
    await main();
  } catch (error) {
    fail(error?.stack ?? String(error));
  }
}

if (failures.length > 0) {
  console.error(`\nSupply-chain lockfile gate: ${failures.length} failure(s).`);
  process.exit(1);
}
console.log('\nSupply-chain lockfile gate: PASS');
