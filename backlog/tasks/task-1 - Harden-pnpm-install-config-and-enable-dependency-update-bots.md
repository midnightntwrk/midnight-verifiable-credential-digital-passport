---
id: TASK-1
title: Harden pnpm install config and enable dependency-update bots
status: To Do
assignee: []
created_date: '2026-08-20 19:40'
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
