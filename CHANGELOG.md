# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Pinned the Compact toolchain at **0.31.1** (was 0.30.0), matching the
  `midnight-did` (#409) and `midnight-verifiable-credentials` (#432)
  migrations. The nix devshell now inherits `compact-toolchain`,
  `compact-midnight`, and the Midnight circuit parameters
  (`midnight-circuit-params`) from the `MediaNoxLabs/flake-collection` flake
  input; the `midnight-did` flake input and the vendored
  `nix/midnight-circuit-params.nix` derivation are gone.
  CI pins the same compiler version (`COMPACT_COMPILER_VERSION: 0.31.1`), and
  the `pinned-compact-compiler-version` flake check still fails loudly on
  drift. Generated managed code is unchanged (byte-identical artifacts).

### Added

- A hermetic `npm-artifacts` flake output (aliased as `default`): a flat
  directory with the `pnpm pack` tarball of every publishable workspace
  package, built offline from a lockfile-pinned fixed-output dependency
  fetch, the pinned Compact toolchain, and flake-supplied circuit parameters
  (`nix build .#npm-artifacts`). The `npm-artifacts-contents` flake check
  audits the tarballs for the distribution invariants (dist output, compact
  sources, helper scripts, no managed source maps, version consistency).
  Publishable packages are discovered at eval time from
  `packages/*/package.json`, so new packages flow in without flake edits.

### Removed

- The `align-runtime-version` post-build workaround
  (`scripts/align-runtime-version.mjs` and its invocation in the `compact`
  build script). compactc 0.31.1 natively targets `compact-runtime` 0.16.0 and
  emits the matching `checkRuntimeVersion` guard, so the generated managed
  code no longer needs any post-build rewriting.
