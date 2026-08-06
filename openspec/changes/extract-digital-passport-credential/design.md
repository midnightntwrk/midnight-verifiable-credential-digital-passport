## Context

This repository is currently an empty Midnight template (governance files, template CI scan, OpenSpec scaffolding). The extraction source is `midnight-verifiable-credentials` at branch `develop-history-2026-08-06`, specifically `packages/prototypes/credential-families/digital-passport` (`@midnight-ntwrk/midnight-did-credentials-digital-passport`), a private prototype with zero workspace dependants. The monorepo's ADR-0013 governs this graduation: the independent repository becomes the sole source of truth for the family; consumers must use registry packages; source-level coupling is forbidden. See proposal.md for motivation and scope; specs for the behavior contract.

Key technical constraints discovered in exploration:

- The family's generated managed code imports **only** `@midnight-ntwrk/compact-runtime` (published, 0.16.0). Generic VC envelope types are compiled into the family contract via compact `include`.
- The compact contract today includes the core contract by monorepo-relative path: `include "../../../../../packages/core/primitives/credentials/src/credentials"`. The core package already publishes `src/**/*.compact` and exports `./credentials.compact` / `./credentials/*.compact`.
- Two source files import unpublished monorepo packages: `codecs.ts` imports the generic compact-value codec (134 lines, depends only on `node:buffer` + `compact-runtime`) from the openid package; `testing/credential-fixtures.ts` imports `Proof`, `VerificationMethodRef`, and proof-challenge circuits from the generic credentials package.
- `index.ts` re-exports fixtures into the root surface; the advertised `./testing` subpath does not exist in the exports map.
- The monorepo build uses `scripts/ensure-compact-package-aliases.mjs`, which delegates to a monorepo-root tooling helper that materializes repo-root symlink aliases — a monorepo-local mechanism.
- CI precedent: `COMPACT_COMPILER_VERSION: 0.30.0`, `midnightntwrk/setup-compact-action` pinned by SHA. Nix precedent: the monorepo flake consumes the midnight-did flake for `compact-toolchain` + `midnight-circuit-params` and pre-populates zkir params for offline compilation (explicitly for digital-passport's build).
- Repo precedent: `midnight-did` (pnpm+turbo workspace, `packages/*`, flake with devshells, engines node ≥ 24 / pnpm ≥ 10, ratcheted actions, published-tarball smoke lanes).

## Goals / Non-Goals

**Goals:**

- A self-contained workspace that builds, tests, and proves consumability of the family package with zero source-level coupling to the monorepo.
- Behavioral-equivalence evidence: ported test suite green on unchanged logic.
- A recorded, verifiable boundary (smoke lane) that can later authorize monorepo-side deletion.

**Non-Goals:**

- Release/publish workflows, versioning scheme, registry publication of this package (deferred change).
- Any behavior change to circuits, claims, encodings, or predicates (P1-3 cleanups become later changes here).
- Deletion or modification of the monorepo copy (change in `midnight-verifiable-credentials`).
- Porting monorepo-scale governance tooling (boundary checks, catalogs, build cones, docs lanes).

## Decisions

### D1. Core dependencies consumed as published RC semver

`@midnight-ntwrk/midnight-did-credentials` must be published as an RC from the monorepo (current shape); this repo pins it as a normal dependency alongside published `compact-runtime`.

- Why: ADR-0013 forbids workspace/git/file/sibling coupling; the graduation gate is "installs only published semantic versions". The fixtures' use of generic proof-challenge circuits is legitimate core logic, not something to re-implement.
- Alternatives rejected: vendoring the generic envelope contract (creates the competing implementation ADR-0013 forbids, repeated by every future family repo); git dependencies (forbidden by the publication contract).

### D2. Compact-value codec inlined, not imported

`encodeCompactPayload`/`decodeCompactPayload` (+ types) are copied into this package with the ported `compact-value-codec.test.ts`, removing the openid dependency entirely.

- Why: 134 lines, protocol-neutral, stateless; publishing the openid package just for it violates the "family must not depend on protocol transport" boundary, and moving it down in core first would block extraction.
- Obligation: bit-compatibility with core's wire format (`compact-value-v1.base64url`, `MCV1` framing) is permanent — wallets and verifiers encode on opposite sides. The ported conformance test is the guard; while the monorepo copy still exists, a cross-check against it is cheap additional evidence.
- Alternatives rejected: moving the codec into `midnight-did-credentials` now (reasonable long-term home, but expands the core-side prerequisite slice); into `credential-model` (violates the catalog's dependency edge table).

### D3. Fixtures behind a first-class `./testing` subpath

Root entry stops re-exporting fixtures; exports map gains `./testing` (and keeps `.`, `./codecs`, `./contract`, and the managed contract subpath). `midnight-did-credentials` remains a normal dependency, imported only via `./testing`.

- Why: matches the README's own surface classification ("Off-chain only fixture surface"), keeps the root minimal, and fixes a broken advertised subpath.

### D4. Package named after the repository

`@midnight-ntwrk/midnight-verifiable-credential-digital-passport`, mirroring the midnight-did precedent (repo name == head package name). On-chain identifiers unchanged.

- Why: never published, so the rename is free now and costly later; sets the product-repo naming precedent. Alternatives considered: legacy name (carries doomed `midnight-did-credentials-` prefix), `credential-digital-passport` (capability-first catalog style; rejected for product identity).

### D5. pnpm + turbo workspace from day one

Private root manifest, `pnpm-workspace.yaml`, `turbo.json`, `packages/*` — mirroring midnight-did. Two workspaces initially: the family package (publishable-ready, `private: true` until the release change) and `packages/smoke-consumer` (private evidence).

### D6. Mechanical migration + docs truthfulness only

Sources port byte-for-byte except: SPDX headers (D9), the compact `include` path (D7), the codec import (D2), the exports/fixture surface (D3), and dependency pins. README reconciled to the actual five-claim schema. All P1-3 behavior cleanups deferred to follow-up changes in this repo.

### D7. Compact include from the installed core package

The contract's core `include` is rewritten from the monorepo-relative path to resolve from the installed `@midnight-ntwrk/midnight-did-credentials` package (tarball ships the compact sources; exports exist). Exact include syntax (package specifier vs node_modules-relative path) is a build-time spike — the first task, since everything downstream depends on it resolving under compact 0.30.0.

### D8. Standalone rework of the alias/build scripts

`ensure-compact-package-aliases.mjs` and friends assume the monorepo-root helper and symlink aliases. In this repo, pnpm resolves the core package in `node_modules` directly; the scripts are reduced to what the standalone build actually needs (likely alias removal, keep `align-runtime-version.mjs` and `strip-managed-sourcemaps.mjs`, adapt `find-repo-root.mjs`). If the include resolves without aliases, the alias script is dropped rather than ported.

### D9. SPDX headers fixed in-port

TS sources gain the SPDX block naming this repository; compact headers re-named from `midnightntwrk/midnight-did` lineage. Comment-only; template mandate.

### D10. Flake mirrors the monorepo's proven inputs

`flake.nix` with `nixpkgs` + `flake-parts` + the midnight-did flake input providing `compact-toolchain` and `midnight-circuit-params`, plus a devshell. This is the exact mechanism the monorepo nix build uses to compile digital-passport offline. CI uses the org's `setup-compact-action` (SHA-pinned) with `COMPACT_COMPILER_VERSION: 0.30.0`; the flake pins the same version.

### D11. Smoke consumer as the boundary proof

`packages/smoke-consumer` (private): packs the built family tarball, installs it with registry-only resolution, imports every public entry point, runs a fixture round-trip. Wired as a CI lane. It goes green only once the core RC is published — until then it is the tracked gate of this change.

## Risks / Trade-offs

- [Core RC publication is an external prerequisite; smoke lane blocked until it lands] → Track as the gate in tasks; everything else (build, tests via pinned dep in workspace install) can proceed using the RC as soon as it exists. Escalate early if the core side stalls.
- [Inlined codec drifts from core] → Ported conformance test + cross-check against the monorepo copy while it exists; document the bit-compatibility obligation in the package README.
- [Compact include syntax from node_modules unproven] → Spike first (task order); fallback is a build-time copy step that stages the core compact sources from node_modules into a local include path.
- [Compiler version drift changes generated code] → Pin 0.30.0 identically in CI env and flake; cache keys include the version (monorepo precedent).
- [The `midnight-did-credentials` RC shape is pre-ADR-0014-split; future re-point needed] → Accepted: one re-point when the `credential-*` split lands; dependency pin makes it a one-line change plus verification.
- [Name length (57 chars scoped)] → Accepted; precedent consistency valued over brevity.

## Migration Plan

1. Spike: resolve the compact include from the installed core package under compact 0.30.0.
2. Scaffold workspace root (manifests, turbo, pnpm-workspace), flake, CI workflows.
3. Port the family package: sources, compact contract (include rewritten), tests, scripts (reworked), exports/fixture surface, codec inlined, headers fixed, dependency pins, README reconciled.
4. Ported suite green in CI → behavioral-equivalence evidence recorded.
5. Smoke consumer workspace + lane; blocked-gate until core RC published, then green.
6. Record deletion criteria for the monorepo-side follow-up change.

Rollback: this repo is additive — nothing here mutates the monorepo. The monorepo copy stays "frozen migration evidence" until its own deletion change, so any failure simply leaves the status quo intact.

## Spike Outcome (Task Group 1)

**1.1 — RC publication gate (RESOLVED → blocking gate tracked):** `@midnight-ntwrk/midnight-did-credentials` is **not published** to the npm registry. Verified 2026-08-06: `npm view @midnight-ntwrk/midnight-did-credentials` returns `E404 Not Found`; a registry search surfaces only the sibling `midnight-did`, `midnight-did-domain`, and `midnight-did-jubjub-schnorr` packages — none is the credentials core. `@midnight-ntwrk/compact-runtime@0.16.0` **is** published (the runtime dependency is available). Per task 1.1, this is recorded as the **blocking gate** of this change; tasks that do not require installation of the RC proceed. The smoke lane (group 6) cannot go green until core publishes the RC.

**1.2 — Include-syntax determination (RESOLVED via selected fallback):** Task 1.2 prescribes two outcomes: (a) determine a direct compact 0.30.0 `include` syntax from the installed core package (package specifier vs node_modules-relative path), or (b) "if none works, adopt the fallback: build-time staging of core compact sources from node_modules into a local include path." The direct-determination inputs remain unavailable — re-confirmed 2026-08-06: (a) the RC is not installable from the registry (gate 1.1; `npm view @midnight-ntwrk/midnight-did-credentials` still returns `E404`), so there are no installed core compact sources to resolve; (b) the compact 0.30.0 compiler is not yet provisioned in this environment (the nix flake providing `compact-toolchain` is itself a group-3 deliverable) — so the direct syntax cannot be empirically confirmed. Task 1.2's fallback branch therefore applies, and the **build-time staging fallback is SELECTED as the working include resolution** for this change (mirroring 1.3 below). This selection satisfies task 1.2's deliverable: a working include resolution is determined and recorded, and it is independent of compact 0.30.0's package-include syntax. The empirical confirmation of a cleaner direct-include syntax (package-specifier or node_modules-relative path) remains a **deferred optimization** — once the RC is published and the toolchain is in place, a clean confirmation downgrades the build to a direct include and drops the staging step. This optimization is tracked in Open Questions and does not block groups 2–7.

**1.3 — Working include resolution (RECORDED):** To keep the critical path unblocked while the syntax spike is deferred, the implementation path for group 4's contract include is **pre-committed to the D7/D8 fallback** — a build-time step that copies the core compact sources from `node_modules/@midnight-ntwrk/midnight-did-credentials` into a local include path, then `include`s them via a repo-relative path. This approach is **independent of compact 0.30.0's package-include syntax** and therefore removes the open question from the critical path. Candidate syntaxes to confirm empirically once the RC + compiler are available (and to adopt in preference to the staging step if they resolve cleanly): (a) package-specifier include against the package's exported compact subpath; (b) node_modules-relative path include. A clean confirmation of either downgrades the build to a direct include and drops the staging step; until then, the staging fallback is the selected working resolution.

## Open Questions

- Exact compact `include` specifier syntax accepted by 0.30.0 for package-installed sources — **deferred pending RC publication + toolchain provision** (see Spike Outcome 1.2/1.3 above); the build-time staging fallback is pre-committed as the working resolution, so this no longer blocks implementation.
- Which RC version number core chooses for `midnight-did-credentials` — **not yet published** (see Spike Outcome 1.1); this repo will pin whatever ships once the RC exists. **Implementation note (group 2):** the family package manifest lists only the published `@midnight-ntwrk/compact-runtime@0.16.0` as a runtime dependency; the `@midnight-ntwrk/midnight-did-credentials` RC pin is **deliberately deferred to group 4** (where the contract `include` and the `./testing` fixtures that import it are ported) because pinning an unpublished package would break `pnpm install` and the clean-install requirement of task 2.4. This deferral is consistent with the 1.1 blocking gate and the registry-resolution requirement (which becomes satisfiable only once the RC publishes); the smoke lane (group 6) is the gate that goes green when it lands.
- Whether the smoke lane lives in `ci.yml` or a dedicated workflow file — cosmetic; decide during implementation.
- DevDependency style at the workspace root (direct pins vs pnpm catalog) — follow midnight-did's style during scaffolding. **Resolved (group 2):** direct pins at the root manifest (no pnpm catalog), matching the midnight-did precedent.
