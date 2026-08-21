---
id: TASK-3
title: Draft digital-passport threat model proposal in docs/security
status: To Do
assignee: []
created_date: '2026-08-20 19:41'
labels: []
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write a repo-specific threat model for the digital-passport credential family so integrators know its security boundaries. Decided placement: draft goes to docs/security/ (not CODEOWNERS-guarded) as a proposal; SECURITY.md itself is owned by mn-security and stays untouched — promotion into SECURITY.md happens only on their blessing (matches the midnight-did precedent of a per-repo threat-model section, but authored here as a proposal document). There is no per-family threat model in the midnight-verifiable-credentials monorepo to port, so content must be written from this repo source. Required boundary areas, grounded in the actual code: (1) claims privacy and selective disclosure semantics of the five committed claims, (2) the age-over-threshold predicate circuit and what it does/does not reveal, (3) presentation-request construction and validation as an input-trust boundary, (4) proof-server/delegated-proving trust and witness confidentiality, (5) issuance and verification key management including what compromise of each key permits. Structural precedents to follow: midnight-did SECURITY.md threat-model section and midnight-verifiable-credentials docs/spec/conformance.md boundary statements. This is hardening PR 3 of 3. One PR per task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docs/security/ contains a threat-model document covering all five boundary areas listed in the description
- [ ] #2 Every stated trust assumption and failure mode is grounded in this repo actual source (file-level references), not generic security boilerplate
- [ ] #3 The selective-disclosure section states precisely which claim values are hidden vs revealed during a presentation
- [ ] #4 The predicate section states what the age-over-threshold circuit reveals and what it does not
- [ ] #5 No CODEOWNERS-guarded file (SECURITY.md, CODEOWNERS, workflow files) is modified
- [ ] #6 CI verify and smoke lanes pass on the PR
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Follow-up issue filed for mn-security to review/promote the proposal into SECURITY.md
<!-- DOD:END -->
