## Purpose

Defines the npm package contract of the digital-passport credential family: its identity, public export surface, dependency policy, inlined wire-format codec, tarball completeness, and the evidence that an external consumer can install and use it as a normal npm package.

## ADDED Requirements

### Requirement: Package identity

The package SHALL be named `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` and SHALL live in the workspace under `packages/midnight-verifiable-credential-digital-passport`. On-chain identifiers of the credential family SHALL remain `midnight:vc:digital-passport` and `digital-passport:v1`, unaffected by package naming.

#### Scenario: Manifest identity

- **WHEN** the package manifest is inspected
- **THEN** the package name is `@midnight-ntwrk/midnight-verifiable-credential-digital-passport` and no on-chain schema identifier references the npm package name

### Requirement: Public export surface

The package SHALL expose exactly these entry points: the root entry (family contract types, codecs, and contract module — excluding fixtures), `./codecs`, `./contract`, and `./testing`. Every documented entry point SHALL resolve through the manifest exports map. Fixtures SHALL NOT be re-exported from the root entry.

#### Scenario: Every advertised subpath resolves

- **WHEN** a consumer imports the root entry, `./codecs`, `./contract`, or `./testing` of the packed package
- **THEN** each import resolves and loads

#### Scenario: Root stays fixture-free

- **WHEN** a consumer imports only the root entry
- **THEN** no fixture module is loaded or required

### Requirement: Registry-resolvable dependencies

The publishable manifest SHALL depend only on packages resolvable from the npm registry at pinned semantic versions — `@midnight-ntwrk/compact-runtime` and the RC of `@midnight-ntwrk/midnight-did-credentials`. The manifest SHALL contain no `workspace:`, `file:`, git, URL, or sibling-path dependencies, and no dependency on the monorepo's openid package.

#### Scenario: Clean resolution from the registry

- **WHEN** the packed tarball is installed in an isolated project
- **THEN** all dependencies resolve from the npm registry without local path overrides

### Requirement: Inlined compact-value codec

The generic compact-value codec (encoding `compact-value-v1.base64url`, `MCV1` framing) SHALL be inlined into the package together with its ported conformance test, replacing the monorepo openid package import. The inlined codec SHALL produce and consume payloads byte-identical to the monorepo core implementation.

#### Scenario: Wire-format compatibility

- **WHEN** a value is encoded with the inlined codec
- **THEN** the payload is decodable by the monorepo core codec, and payloads produced by the core codec decode to the same value via the inlined codec

#### Scenario: Codec conformance suite ported

- **WHEN** the package tests run
- **THEN** the ported codec conformance test passes

### Requirement: Complete, publishable tarball

The package SHALL carry everything needed to consume or rebuild it: compiled distribution output, generated contract exports, the compact contract sources, and the build helper scripts declared in the manifest files list. It SHALL NOT ship source maps of managed generated code or any secret material.

#### Scenario: Tarball contents sufficient

- **WHEN** the tarball is produced from a clean build
- **THEN** it contains the dist output, compact sources, and declared scripts, and contains no managed-code source maps

### Requirement: Consumer consumability evidence

The repository SHALL include a private consumer workspace and CI lane that: pack the built package, install the tarball into a clean environment, import every public entry point, and execute a credential fixture round-trip using only registry-resolved dependencies. This lane SHALL pass before the monorepo duplicate may be deleted.

#### Scenario: Smoke round-trip

- **WHEN** the smoke lane runs against the built tarball
- **THEN** installation succeeds, every public entry point imports, and an issuance/presentation fixture round-trip validates

### Requirement: Provenance headers

Every ported source file SHALL carry an SPDX header block naming this repository. Existing headers naming other repositories SHALL be corrected during the port. Header changes SHALL be comment-only.

#### Scenario: Headers name this repository

- **WHEN** any source file of the ported package is inspected
- **THEN** its SPDX header names `midnight-verifiable-credential-digital-passport` and no source file carries a header naming another repository
