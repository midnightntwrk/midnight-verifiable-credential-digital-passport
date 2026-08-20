---
id: TASK-1
title: Harden pnpm install config and enable dependency-update bots
status: In Progress
assignee:
  - '@pi-agent'
created_date: '2026-08-20 19:40'
updated_date: '2026-08-20 20:16'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adopt the midnight-did supply-chain install policy so newly published compromised packages cannot enter this repo through install: pnpm-workspace.yaml gains blockExoticSubdeps, minimumReleaseAge 10080, and trustPolicy no-downgrade (with empty minimumReleaseAgeExclude/trustPolicyExclude lists to start); .npmrc gains min-release-age=7. Build-script execution becomes explicit policy by declaring the packages pnpm currently skips silently (esbuild, unrs-resolver) in ignoredBuiltDependencies. Decision from review: run both update bots sibling-style — add renovate.json extending local>midnightntwrk/renovate-config (base branch main only; the Renovate app is installed and dormant on this repo, proven by the renovate/configure branch on origin) and re-enable the currently commented-out npm lane in .github/dependabot.yml (daily schedule, 7-day cooldown). Verified compatible: clean frozen-lockfile install under pnpm 10.34.1 with these exact settings succeeds in 7s with no rejections. This is hardening PR 1 of 3 (slicing decision: config lands unblocked). One PR per task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm install --frozen-lockfile succeeds on a clean checkout with the new workspace settings
- [ ] #2 pnpm-workspace.yaml declares blockExoticSubdeps: true, minimumReleaseAge: 10080, trustPolicy: no-downgrade, with empty exclusion lists
- [ ] #3 Build-script policy is explicit: ignoredBuiltDependencies lists every package pnpm would otherwise skip silently
- [ ] #4 .npmrc sets min-release-age=7
- [ ] #5 renovate.json extends local>midnightntwrk/renovate-config and targets main only
- [ ] #6 dependabot.yml has an active npm ecosystem lane (directory /) with a schedule and 7-day cooldown
- [ ] #7 CI verify and smoke lanes pass on the PR
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add supply-chain install policy to pnpm-workspace.yaml: blockExoticSubdeps: true, minimumReleaseAge: 10080 (7 days), trustPolicy: no-downgrade, empty minimumReleaseAgeExclude/trustPolicyExclude lists, and ignoredBuiltDependencies: [esbuild, unrs-resolver] (the exact packages pnpm currently skips silently per node_modules/.modules.yaml ignoredBuilds).
2. Add min-release-age=7 to .npmrc.
3. Add root renovate.json extending local>midnightntwrk/renovate-config with baseBranches: ["main"] (matches the dormant Renovate onboarding config on origin/renovate/configure).
4. Re-enable the npm lane in .github/dependabot.yml (directory /, daily schedule, 7-day cooldown), leaving other commented lanes untouched.
5. Verify: clean-checkout corepack pnpm install --frozen-lockfile in a temp copy of the tree; confirm install succeeds with no rejections and no silent build-script warnings; validate renovate.json (Renovate config validator) and dependabot.yml; run the CI lane equivalents locally (pnpm run all, smoke-consumer smoke) where toolchain permits.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented all config changes (pnpm-workspace.yaml, .npmrc, renovate.json, .github/dependabot.yml).

EVIDENCE per acceptance criterion (all commands actually run):
- AC1: Clean-checkout proof: exported HEAD via git archive to /tmp/task1-clean, overlaid the 4 changed files, ran 'corepack pnpm install --frozen-lockfile' -> exit 0, Done in 867ms, 305 packages, no rejections, no ignored-build warning. Also rm -rf node_modules + reinstall in the working tree with '--frozen-lockfile --prefer-offline' (CI setup-action args) -> exit 0 in 1.3s.
- AC2: pnpm-workspace.yaml sets blockExoticSubdeps: true, minimumReleaseAge: 10080, trustPolicy: no-downgrade, minimumReleaseAgeExclude: [], trustPolicyExclude: []. Confirmed pnpm 10.34.1 parses them: 'pnpm config get' returned true / 10080 / no-downgrade / [] / []. Negative test (CORRECTED in review round 2 — the earlier claim here was false): pnpm does NOT reject bad policy config; trustPolicy: bogus-value, a misspelled key (trustPoliy), and misspelled minimumReleaseAges/blockExoticSubdep all leave 'pnpm install --frozen-lockfile' exiting 0 (re-verified: installs complete, exit 0 — unknown keys and invalid values are silently ignored, so the policy fails open by itself; 'pnpm config get <key>' is what surfaces the mistake: raw bogus value, or undefined for a misspelled key). Fail-closed safety net added: scripts/check-install-policy.mjs (run via 'pnpm run verify:install-policy', chained into 'pnpm run all' so the CI verify lane gates it) statically validates every policy key/value in pnpm-workspace.yaml, cross-checks each setting through 'pnpm config get --json', and checks .npmrc min-release-age=7; verified it exits 1 on misspelled keys, invalid or weakened values, removed keys, non-empty exclusion lists, and .npmrc regressions, exit 0 on the real config.
- AC3: ignoredBuiltDependencies: [esbuild, unrs-resolver] — exactly the two packages pnpm skipped silently before (node_modules/.modules.yaml ignoredBuilds: esbuild@0.28.1, unrs-resolver@1.12.2). Fresh install with the declaration: no 'Ignored build scripts' warning, .modules.yaml ignoredBuilds: [].
- AC4: .npmrc now contains min-release-age=7 (npm-side setting; pnpm 10.34.1 does not read this key, verified via grep of the pnpm dist, so it does not conflict with workspace minimumReleaseAge=10080).
- AC5: renovate.json at repo root: {$schema, extends: [local>midnightntwrk/renovate-config], baseBranches: [main]}. Validated with 'npx -p renovate renovate-config-validator renovate.json' -> 'Config validated successfully against 1 file(s)' (only a non-fatal migration hint baseBranches->baseBranchPatterns from latest Renovate; kept baseBranches for compat with the org preset style). Shared preset confirmed public: curl raw.githubusercontent.com/midnightntwrk/renovate-config/main/default.json -> 200. Matches the dormant onboarding config on origin/renovate/configure (extends identical).
- AC6: .github/dependabot.yml npm lane uncommented: package-ecosystem npm, directory /, schedule daily, cooldown default-days 7. Validated structurally with PyYAML: 'PASS: active npm lane with directory /, daily schedule, 7-day cooldown'. (@dependabot/cli is not on npm; GitHub validates the file server-side on push.)
- AC7: Ran the exact CI lane commands locally in 'nix develop' (compact 0.31.1 = pinned COMPACT_COMPILER_VERSION): verify lane 'pnpm run all' -> lint+typecheck+build+test:ci all green, 60/60 vitest tests passed, turbo '2 successful, 2 total'; smoke lane 'pnpm --filter smoke-consumer smoke' -> registry-resolution install + full round-trip 'SMOKE OK ... smoke: PASS — boundary evidence recorded', exit 0. GitHub Actions pass on the PR itself must be observed post-push (no gh access from this session); both lanes' commands were executed green under the new install policy.

Notes:
- Style: edits keep the repo's existing double-quoted YAML style; prettier is not enforced in CI (no format script) and the pre-existing yaml files were already non-prettier-conformant under .prettierrc.json (singleQuote), so no restyle was forced.
- Environment note: the backlog project (backlog/) lives only on the hardening-backlog branch; it was exported (untracked) into this working tree via 'git archive origin/hardening-backlog backlog' so the mandated backlog CLI workflow could run. Orchestrator decides whether to carry the updated backlog files into the PR.
<!-- SECTION:NOTES:END -->
