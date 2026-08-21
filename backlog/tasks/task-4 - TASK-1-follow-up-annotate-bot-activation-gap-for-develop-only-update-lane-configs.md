---
id: TASK-4
title: >-
  TASK-1 follow-up: annotate bot-activation gap for develop-only update-lane
  configs
status: To Do
assignee: []
created_date: '2026-08-21 07:14'
labels:
  - follow-up
dependencies: []
references:
  - >-
    https://github.com/midnightntwrk/midnight-verifiable-credential-digital-passport/pull/11
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review finding from PR #11 (non-blocking, docs/process): .github/dependabot.yml:19 npm update lane and renovate.json only take effect from the repo's default branch (main). After PR #11 merges into develop, both bots stay dormant until an unautomated develop→main sync happens, so the checked-off ACs #5/#6 do not reflect this activation gap (acknowledged in the PR description). Suggestion: annotate the TASK-1 backlog acceptance criteria (and/or the config-file comments) so the dormant-until-sync state is explicit, and confirm the repo's develop→main sync process covers landing these bot configs on main. Discovered in PR review.
<!-- SECTION:DESCRIPTION:END -->
