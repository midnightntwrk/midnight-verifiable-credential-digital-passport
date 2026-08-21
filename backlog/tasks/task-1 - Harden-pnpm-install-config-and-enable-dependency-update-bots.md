---
id: TASK-1
title: Harden pnpm install config and enable dependency-update bots
status: Done
assignee:
  - '@ai-agent'
created_date: '2026-08-20 19:40'
updated_date: '2026-08-21 07:14'
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
- [x] #1 pnpm install --frozen-lockfile succeeds on a clean checkout with the new workspace settings
- [x] #2 pnpm-workspace.yaml declares blockExoticSubdeps: true, minimumReleaseAge: 10080, trustPolicy: no-downgrade, with empty exclusion lists
- [x] #3 Build-script policy is explicit: ignoredBuiltDependencies lists every package pnpm would otherwise skip silently
- [x] #4 .npmrc sets minimum-release-age=10080 (7 days) — corrected in review round 1 from min-release-age=7, a spelling pnpm 10.34.1 silently ignores
- [x] #5 renovate.json extends local>midnightntwrk/renovate-config and targets develop via baseBranchPatterns — corrected in review round 1 from baseBranches ["main"]; main is a skeleton branch with no npm manifests, so a main-only lane would never produce npm update PRs
- [x] #6 dependabot.yml has an active npm ecosystem lane (directory /) with a schedule and 7-day cooldown
- [x] #7 CI verify and smoke lanes pass on the PR
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Edit pnpm-workspace.yaml: add blockExoticSubdeps: true, minimumReleaseAge: 10080, minimumReleaseAgeExclude: [], trustPolicy: no-downgrade, trustPolicyExclude: [], and ignoredBuiltDependencies: [esbuild, unrs-resolver] (verified via fresh-clone frozen install: exactly these two build scripts are silently skipped by pnpm 10.34.1). 2. Edit .npmrc: add min-release-age=7. 3. Add renovate.json at repo root: $schema renovate-schema, extends ["local>midnightntwrk/renovate-config"], baseBranches ["main"] so the dormant Renovate app opens updates against main only. 4. Edit .github/dependabot.yml: uncomment the npm ecosystem lane (directory /, schedule daily, cooldown default-days 7), leaving other commented lanes untouched. 5. Validate in a clean git worktree: pnpm install --frozen-lockfile succeeds with no ignored-build-scripts warning, pnpm-lock.yaml unchanged, then run pnpm run all and pnpm --filter smoke-consumer smoke locally; validate renovate.json/dependabot.yml syntax. 6. Commit and open PR against develop; confirm CI verify and smoke lanes pass on the PR.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 1 done: pnpm-workspace.yaml now declares blockExoticSubdeps: true, minimumReleaseAge: 10080, minimumReleaseAgeExclude: [], trustPolicy: no-downgrade, trustPolicyExclude: [], ignoredBuiltDependencies: [esbuild, unrs-resolver]; .npmrc adds min-release-age=7. Local frozen install under pnpm 10.34.1 succeeds in 710ms with no ignored-build-scripts warning and leaves pnpm-lock.yaml untouched.

Slice 2 done: added renovate.json ($schema, extends [local>midnightntwrk/renovate-config], baseBranches [main]) and uncommented the dependabot.yml npm lane (directory /, daily schedule, cooldown default-days 7), leaving cargo/docker/registries lanes commented. renovate.json validated with renovate-config-validator 44.35.3: 'Config validated successfully against 1 file(s)' with the local> preset resolving against midnightntwrk/renovate-config@main (exit 0; only a cosmetic baseBranches->baseBranchPatterns migration WARN, baseBranches kept as required). dependabot.yml parses as valid YAML with exactly two active lanes (github-actions, npm) and npm lane = {directory: /, schedule: daily, cooldown: 7 days}.

Validation (clean git worktree /tmp/task1-clean at 5e73d73, detached): AC#1 pnpm install --frozen-lockfile exit 0 in 965ms. AC#3 baseline worktree at origin/develop (f535fcd) fresh install warns 'Ignored build scripts: esbuild@0.28.1, unrs-resolver@1.12.2' — exactly the two entries now declared in ignoredBuiltDependencies; hardened install emits zero such warnings and 'git status --porcelain' is empty (pnpm-lock.yaml unchanged). AC#2/#4 verified in files and accepted by pnpm 10.34.1 (pnpm config get: trust-policy=no-downgrade, block-exotic-subdeps=true, minimum-release-age=10080, min-release-age=7). AC#5 renovate-config-validator 44.35.3: 'Config validated successfully against 1 file(s)' exit 0 with local>midnightntwrk/renovate-config resolving (repo exists, public, default.json preset). AC#6 dependabot.yml parses with active lanes {github-actions, npm}; npm lane directory /, interval daily, cooldown default-days 7; cargo/docker/registries lanes untouched. Full gate: pnpm run all exit 0 (8 files/60 tests) and pnpm --filter smoke-consumer smoke exit 0 (SMOKE OK round-trip) both in the clean worktree and the main repo. AC#7 (CI on PR) pending: local run was forbidden to push/open the PR.

Final validation (local, repo root at PR head 1b3c295, pnpm 10.34.1, compact 0.31.1): pnpm install --frozen-lockfile exit 0 (lockfile untouched); pnpm run all exit 0 (lint+typecheck+build+test, 8 files/60 tests passed); pnpm run smoke exit 0 (SMOKE OK: all public entry points imported, issuance/presentation/verification and codec round-trips succeeded). AC#7 proven by PR CI at head 1b3c295: 'Typecheck, Lint, Build, Test' (verify) = SUCCESS and 'Consumer smoke (boundary evidence)' (smoke) = SUCCESS; dependabot config check also SUCCESS; PR #11 OPEN vs develop, MERGEABLE.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @ai-agent
created: 2026-08-21 06:34
---
AC#7 (CI verify+smoke lanes on the PR) intentionally left unchecked: this run was forbidden to push or open a PR; both lanes passed locally in a clean worktree (pnpm run all, pnpm --filter smoke-consumer smoke). Out-of-scope observation for review: pnpm 10.34.1 does not consume the .npmrc key min-release-age (0 occurrences in its dist; only minimum-release-age is read) — the effective 7-day guard is minimumReleaseAge: 10080 in pnpm-workspace.yaml, and min-release-age=7 mirrors the midnight-did policy verbatim as specified. Renovate validator also emitted a cosmetic migration WARN suggesting baseBranchPatterns over baseBranches; baseBranches kept since the AC and the pinned Renovate app expect it.

Review round 1 (Claude /code-review on PR #11) corrections applied: (1) .npmrc min-release-age=7 renamed to minimum-release-age=10080 — pnpm 10.34.1 ignores the former key entirely (verified via `pnpm config get`: recognized key resolves, pnpm-workspace.yaml still wins with the identical 10080 so install behavior is unchanged); (2) renovate.json baseBranches ["main"] replaced with baseBranchPatterns ["develop"] — origin/main is a manifest-less skeleton (no package.json/pnpm-workspace.yaml/packages), confirmed via `git ls-tree origin/main`, so a main-only Renovate lane would never surface npm updates, and develop is where every dependency actually lives and where update PRs must land; (3) dependabot.yml npm lane gains target-branch: develop so Dependabot reads develop's manifests and opens npm PRs against develop (the github-actions lane keeps defaulting to main, matching merged bot PR #3). Both bots still need their config files on the default branch to activate, which happens through the repo's normal develop→main sync (main is currently an ancestor of develop). Renovate field renamed to the current baseBranchPatterns, clearing the validator's deprecation warning as a side effect.
---
author: @ai-agent
created: 2026-08-21 13:48
---
Claude /code-review round 1 on PR #11 flagged three findings; two blocking (dead .npmrc key; update lanes aimed at manifest-less main) fixed in the round-1 commit, one non-blocking (deprecated baseBranches field) fixed alongside since the line was being edited anyway. Renovate re-validated with renovate-config-validator, dependabot.yml re-parsed, and pnpm run all re-run green after the changes.
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened pnpm install config and enabled dependency-update bots: pnpm-workspace.yaml now declares blockExoticSubdeps: true, minimumReleaseAge: 10080 (with empty exclusion lists), trustPolicy: no-downgrade, and ignoredBuiltDependencies [esbuild, unrs-resolver] making build-script policy explicit; .npmrc sets minimum-release-age=10080; renovate.json extends local>midnightntwrk/renovate-config targeting develop via baseBranchPatterns; dependabot.yml npm lane re-enabled (directory /, daily, 7-day cooldown, target-branch develop). Verified: clean frozen-lockfile install exit 0 with no ignored-build-scripts warning and lockfile unchanged; pnpm run all exit 0 (8 files/60 tests); pnpm run smoke exit 0 (SMOKE OK round-trip); renovate-config-validator exit 0; PR #11 CI verify lane ('Typecheck, Lint, Build, Test') and smoke lane ('Consumer smoke (boundary evidence)') both SUCCESS at head 1b3c295.
<!-- SECTION:FINAL_SUMMARY:END -->
