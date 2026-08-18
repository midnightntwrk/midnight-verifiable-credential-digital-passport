# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Pinned the Compact toolchain at **0.31.1** (was 0.30.0), matching the
  `midnight-did` (#409) and `midnight-verifiable-credentials` (#432)
  migrations. The nix devshell now inherits `compact-toolchain` and
  `compact-midnight` from the `MediaNoxLabs/flake-collection` flake input, and
  the Midnight circuit parameters are vendored as a self-contained derivation
  (`nix/midnight-circuit-params.nix`); the `midnight-did` flake input is gone.
  CI pins the same compiler version (`COMPACT_COMPILER_VERSION: 0.31.1`), and
  the `pinned-compact-compiler-version` flake check still fails loudly on
  drift. Generated managed code is unchanged (byte-identical artifacts).

### Removed

- The `align-runtime-version` post-build workaround
  (`scripts/align-runtime-version.mjs` and its invocation in the `compact`
  build script). compactc 0.31.1 natively targets `compact-runtime` 0.16.0 and
  emits the matching `checkRuntimeVersion` guard, so the generated managed
  code no longer needs any post-build rewriting.
