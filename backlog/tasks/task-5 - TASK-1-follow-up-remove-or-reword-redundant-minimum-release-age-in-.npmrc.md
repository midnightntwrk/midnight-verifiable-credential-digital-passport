---
id: TASK-5
title: 'TASK-1 follow-up: remove or reword redundant minimum-release-age in .npmrc'
status: To Do
assignee: []
created_date: '2026-08-21 07:14'
labels:
  - follow-up
dependencies: []
references:
  - >-
    https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport/pull/11
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review finding from PR #11 (non-blocking): .npmrc:6 sets minimum-release-age=10080, which is redundant and has zero effect because pnpm-workspace.yaml's minimumReleaseAge always takes precedence. The adjacent comment implies an independent second guard that doesn't exist. Suggestion: remove the line entirely, or reword the comment to state it mirrors pnpm-workspace.yaml's minimumReleaseAge rather than acting as a separate guard. Also noted during final validation: npm (not pnpm) warns 'Unknown project config minimum-release-age' when reading this .npmrc. Discovered in PR review.
<!-- SECTION:DESCRIPTION:END -->
