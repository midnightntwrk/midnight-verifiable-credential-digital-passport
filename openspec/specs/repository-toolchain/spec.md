## Purpose

Defines the repository's reproducible development and continuous-integration contract: the workspace layout, engine requirements, pinned Compact toolchain for local and CI builds, and the required CI lanes including security hygiene.

## Requirements

### Requirement: Workspace layout

The repository SHALL be a pnpm workspace with turbo task orchestration and a private root manifest. Publishable packages and private evidence workspaces SHALL live under `packages/`. The repository SHALL NOT require sibling-repository source paths, git submodules, or cross-repository workspace imports at any stage (install, build, or test).

#### Scenario: Self-contained checkout

- **WHEN** a clean checkout is installed and built
- **THEN** every step succeeds using only this repository plus registry-resolved dependencies

### Requirement: Engine requirements

The repository SHALL require Node.js >= 24 and pnpm >= 10, declared in the root manifest and enforced for package workspaces.

#### Scenario: Engines declared

- **WHEN** the root manifest is inspected
- **THEN** it declares Node >= 24 and pnpm >= 10 engine constraints

### Requirement: Pinned Compact toolchain

The Compact compiler version SHALL be pinned identically for CI and for the nix development shell. The CI lane SHALL install the compiler through the organization's setup-compact action pinned by commit SHA. The nix flake SHALL provide the compact toolchain and circuit parameters required for offline compilation, both sourced from the `MediaNoxLabs/flake-collection` flake input: the toolchain as `compact-toolchain` and the circuit parameters as `midnight-circuit-params`. The flake SHALL NOT depend on the `midnight-did` repository for any build input, and circuit parameters SHALL NOT be vendored as a derivation in this repository. A build-time check SHALL fail if the provided toolchain version ever drifts from the pin.

#### Scenario: Compiler versions agree

- **WHEN** the CI workflow environment and the flake-provided toolchain are compared
- **THEN** both provide the same pinned Compact compiler version

#### Scenario: Toolchain is upstream-independent

- **WHEN** the nix flake inputs are inspected
- **THEN** the compact toolchain and the circuit parameters both resolve through `MediaNoxLabs/flake-collection`, with no `midnight-did` input and no locally vendored circuit-parameter derivation

#### Scenario: Offline contract compilation

- **WHEN** the compact contract is compiled inside the nix development shell
- **THEN** compilation succeeds without network access beyond the flake inputs

#### Scenario: Toolchain drift fails loudly

- **WHEN** the flake-provided compact toolchain version differs from the pinned compiler version
- **THEN** the build-time version check fails with an actionable error

### Requirement: Native runtime-version guard

The compact compiler SHALL be pinned to a version whose emitted `checkRuntimeVersion` guard matches the runtime version this repository depends on (`@midnight-ntwrk/compact-runtime@0.16.0`). The build SHALL NOT rewrite the compiler-emitted guard in generated managed code: the guard present in the built artifacts SHALL be the one the compiler emitted natively.

#### Scenario: Guard matches the installed runtime

- **WHEN** the generated managed contract module is loaded with this package's pinned compact-runtime
- **THEN** the compiler-emitted version guard passes without any post-build modification of the generated code

#### Scenario: No align-version workaround in the build

- **WHEN** the package's compact build script is inspected
- **THEN** it performs no runtime-version rewriting step and ships no such helper script

### Requirement: Continuous integration lanes

The repository SHALL run, on pull requests and pushes to the integration branch, a lane that typechecks, lints, builds, and tests all workspaces. The repository SHALL additionally carry dependency-review, scorecard, and template scan lanes.

#### Scenario: PR lane exercises the full contract

- **WHEN** a pull request changes any workspace
- **THEN** CI runs typecheck, lint, build, and test and fails on any regression

#### Scenario: Security hygiene lanes present

- **WHEN** the repository workflows are inspected
- **THEN** dependency-review, scorecard, and scan workflows exist and are active

### Requirement: Build evidence for the migration

The CI build SHALL compile the compact contract from source and run the full ported test suite, providing the behavioral-equivalence evidence for the extraction.

#### Scenario: Green migration evidence

- **WHEN** CI runs on the extracted workspace
- **THEN** compact compilation, package build, and the ported test suite all succeed
