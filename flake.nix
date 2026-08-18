# SPDX-License-Identifier: Apache-2.0
#
# This repository's reproducible development shell and hermetic npm artifact
# packaging. The Compact toolchain (`compact-toolchain`, `compact-midnight`)
# and the Midnight circuit parameters (`midnight-circuit-params`) are sourced
# from the `MediaNoxLabs/flake-collection` flake input — the same reusable
# packaging the `midnight-verifiable-credentials` and `midnight-did`
# repositories consume — so the `digital-passport-credential` compact contract
# compiles fully offline (no network access beyond the flake inputs), with no
# dependency on the `midnight-did` repository for any build input and no
# vendored circuit-parameter derivation in this repository.
#
# The `npm-artifacts` package output (aliased as `default`) packs every
# publishable (non-private) workspace package with its real `prepack`
# pipeline, hermetically: a fixed-output `pnpm fetch` provides the offline
# dependency store, the toolchain and circuit parameters come from flake
# inputs, and `packages.<system>.npm-artifacts` is a flat directory of the
# resulting `.tgz` tarballs for downstream `nix build` consumption. The
# `npm-artifacts-contents` check audits those tarballs for the distribution
# invariants (dist output, compact sources, scripts, no managed source maps,
# version consistency).
#
# The Compact compiler version is pinned to a single source of truth
# (`compactCompilerVersion` below). The `pinned-compact-compiler-version`
# check fails the build if the toolchain ever drifts away from it, and the CI
# lane (`.github/workflows/ci.yml`) pins the same version for the setup-compact
# action. See the `repository-toolchain` spec ("Pinned Compact toolchain") and
# the `npm-artifacts-distribution` spec.
{
  description = "Midnight verifiable credential: digital passport — development environment and npm artifact packaging";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    # Provides `compact-toolchain`, `compact-midnight`, and
    # `midnight-circuit-params` — the same reusable toolchain and circuit
    # parameter packaging the sibling repositories consume for Compact 0.31.1
    # (mirrors midnight-did#409 and midnight-verifiable-credentials#432). The
    # pinned revision is recorded in `flake.lock`.
    flake-collection.url = "github:MediaNoxLabs/flake-collection";
    flake-collection.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    inputs@{
      self,
      flake-parts,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        {
          system,
          inputs',
          ...
        }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          lib = pkgs.lib;

          # Compact compiler pin — single source of truth. MUST agree with the
          # CI lane (`COMPACT_COMPILER_VERSION` in ci.yml) and with the version
          # published by flake-collection's `compact-toolchain`.
          compactCompilerVersion = "0.31.1";

          # The toolchain and the circuit parameters both come from
          # flake-collection so this repo does not duplicate their packaging:
          # `compactc`, `fixup-compact`, and `format-compact` are under
          # `compact-toolchain`; the `compact` devtool (which reads
          # `COMPACT_DIRECTORY` and invokes the compiler) is `compact-midnight`;
          # the zkir parameter sets are `midnight-circuit-params`.
          compact-midnight = inputs'.flake-collection.packages.compact-midnight;
          compact-toolchain = inputs'.flake-collection.packages.compact-toolchain;
          midnight-circuit-params = inputs'.flake-collection.packages.midnight-circuit-params;

          # ----------------------------------------------------------------------
          # npm artifact packaging (change `npm-artifacts-flake-output`)
          # ----------------------------------------------------------------------

          # Root-level files the offline install and the build pipeline need.
          # Everything else at the repository root (docs, CI, specs) is outside
          # the packaged workspace source. `LICENSE` matters: pnpm pack walks
          # up to the workspace root for it, so the flake-built tarball ships
          # the license exactly like the smoke-lane artifact.
          rootFileNames = [
            ".npmrc"
            ".nvmrc"
            "LICENSE"
            "package.json"
            "pnpm-lock.yaml"
            "pnpm-workspace.yaml"
            "tsconfig.json"
            "turbo.json"
          ];

          # Minimal root set that influences `pnpm fetch` — kept narrower than
          # `rootFileNames` so irrelevant root-file edits cannot churn the
          # fixed-output store hash.
          manifestFileNames = [
            ".npmrc"
            "package.json"
            "pnpm-lock.yaml"
            "pnpm-workspace.yaml"
          ];

          # Build outputs and scratch trees that must never enter the sandbox:
          # `prepack` regenerates them from source (design D4).
          excludedDirNames = [
            ".pi"
            ".turbo"
            "core-compact-staging"
            "coverage"
            "dist"
            "managed"
            "node_modules"
            "reports"
            "result"
          ];

          relativeToSelf =
            path: lib.removePrefix (toString self + "/") (toString path);

          # Eval-time auto-discovery (design D5): read every
          # `packages/*/package.json` and select the publishable (non-private)
          # ones. A malformed manifest fails evaluation loudly; a newly added
          # publishable package flows into `npm-artifacts` with no flake edits.
          publishablePackages =
            let
              packagesRoot = "${self}/packages";
              entries = builtins.readDir packagesRoot;
              packageDirs = lib.attrNames (lib.filterAttrs (_: type: type == "directory") entries);
              manifests = map (dir: {
                dir = "packages/${dir}";
                manifest = builtins.fromJSON (builtins.readFile "${packagesRoot}/${dir}/package.json");
              }) packageDirs;
              publishable = builtins.filter ({ manifest, ... }: !(manifest.private or false)) manifests;
            in
            map
              (
                { dir, manifest }:
                let
                  baseName = lib.last (lib.splitString "/" manifest.name);
                  # npm/pnpm packing convention for the tarball filename: the
                  # scope is kept, `@` and `/` become `-` (e.g.
                  # `@scope/name@1.0.0` -> `scope-name-1.0.0.tgz`).
                  tarballName = "${lib.replaceStrings [ "@" "/" ] [ "" "-" ] manifest.name}-${manifest.version}.tgz";
                in
                {
                  inherit dir;
                  name = manifest.name;
                  version = manifest.version;
                  inherit baseName tarballName;
                }
              )
              publishable;

          # Manifest-only source for the fixed-output `pnpm fetch`: root
          # manifests + lockfile + workspace package manifests. Its output hash
          # therefore changes exactly when the lockfile or pins change.
          manifestSource = lib.cleanSourceWith {
            name = "npm-manifests-src";
            src = self;
            filter =
              path: type:
              let
                rel = relativeToSelf path;
                components = lib.splitString "/" rel;
                depth = builtins.length components;
              in
              if builtins.head components == "packages" then
                depth <= 2 || (depth == 3 && baseNameOf path == "package.json")
              else
                depth == 1 && lib.elem (baseNameOf path) manifestFileNames;
          };

          # Workspace source for the tarball derivation (design D4): root
          # manifests plus the `packages/` trees, minus generated build outputs.
          workspaceSource = lib.cleanSourceWith {
            name = "npm-workspace-src";
            src = self;
            filter =
              path: type:
              let
                rel = relativeToSelf path;
                components = lib.splitString "/" rel;
                depth = builtins.length components;
              in
              if builtins.head components == "packages" then
                !(type == "directory" && lib.elem (baseNameOf path) excludedDirNames)
              else
                depth == 1 && lib.elem (baseNameOf path) rootFileNames;
          };

          # Fixed-output dependency fetch (design D2): offline store + the
          # corepack-pinned pnpm provision. The recorded hash is refreshed
          # mechanically when `pnpm-lock.yaml` changes.
          pnpmOfflineStore = import ./nix/pnpm-offline-store.nix {
            inherit lib;
            stdenv = pkgs.stdenv;
            nodejs = pkgs.nodejs_24;
            cacert = pkgs.cacert;
          };

          offlineStore = pnpmOfflineStore { src = manifestSource; };

          npmTarball = import ./nix/npm-tarball.nix;

          tarballFor =
            pkg:
            npmTarball {
              inherit lib pkg;
              stdenv = pkgs.stdenv;
              nodejs = pkgs.nodejs_24;
              inherit compact-midnight compact-toolchain midnight-circuit-params;
              src = workspaceSource;
              inherit offlineStore;
            };

          # One derivation per publishable package, aggregated as a flat
          # directory of tarballs (design D1).
          npm-artifacts = pkgs.linkFarm "npm-artifacts" (
            map (pkg: {
              name = pkg.tarballName;
              path = "${tarballFor pkg}/${pkg.tarballName}";
            }) publishablePackages
          );

          # Content audit of every packed tarball (design D8): dist output with
          # the managed contract index, compact sources, helper scripts, no
          # managed source maps or secret material, and filename/manifest
          # version consistency. Failures name the offending tarball and the
          # violation.
          npmArtifactsContentsCheck =
            let
              artifacts = npm-artifacts;
              assertTarball =
                pkg:
                let
                  tgz = "${artifacts}/${pkg.tarballName}";
                in
                ''
                  tgz="${tgz}"
                  if [ ! -f "$tgz" ]; then
                    echo "ERROR: npm-artifacts-contents: tarball ${pkg.tarballName} (package ${pkg.name}) is missing from the npm-artifacts output" >&2
                    exit 1
                  fi
                  work="$(mktemp -d)"
                  tar -xzf "$tgz" -C "$work"
                  root="$work/package"
                  violation() {
                    echo "ERROR: npm-artifacts-contents: tarball ${pkg.tarballName} (package ${pkg.name}): $1" >&2
                    exit 1
                  }
                  manifest_version="$(jq -r '.version' "$root/package.json")"
                  if [ "$manifest_version" != "${pkg.version}" ]; then
                    violation "tarball filename version (${pkg.version}) does not match the packed manifest version ($manifest_version)"
                  fi
                  if [ -z "$(find "$root/dist" -type f -print -quit)" ]; then
                    violation "compiled distribution output (package/dist/) is missing or empty"
                  fi
                  if ! ls "$root"/dist/managed/*/contract/index.js >/dev/null 2>&1; then
                    violation "managed contract index (package/dist/managed/<contract>/contract/index.js) is missing"
                  fi
                  if [ -z "$(find "$root/src" -type f -name '*.compact' -print -quit)" ]; then
                    violation "compact contract sources (package/src/**/*.compact) are missing"
                  fi
                  if [ -z "$(find "$root/scripts" -type f -name '*.mjs' -print -quit)" ]; then
                    violation "build helper scripts (package/scripts/*.mjs) are missing"
                  fi
                  if maps="$(find "$root/dist/managed" -type f -name '*.map' -print)" && [ -n "$maps" ]; then
                    echo "$maps" >&2
                    violation "managed-code source maps are shipped under package/dist/managed/"
                  fi
                  if secrets="$(find "$root" -type f \( -name '*.pem' -o -name '*.key' -o -name '.env' -o -name '.env.*' \) -print)" && [ -n "$secrets" ]; then
                    echo "$secrets" >&2
                    violation "possible secret material is shipped in the tarball"
                  fi
                  rm -rf "$work"
                '';
            in
            pkgs.runCommand "check-npm-artifacts-contents"
              {
                nativeBuildInputs = [ pkgs.jq ];
                meta.description = "Audits the npm-artifacts tarballs for the distribution invariants (dist output, compact sources, scripts, no managed source maps, version consistency)";
              }
              ''
                set -euo pipefail
                ${lib.concatStrings (map assertTarball publishablePackages)}
                touch "$out"
              '';
        in
        {
          _module.args.pkgs = pkgs;

          # Enforce the compiler pin at build time. If flake-collection ever
          # ships a different compact-toolchain version, `nix flake check`
          # (and any build consuming this output) fails loudly instead of
          # silently producing divergent managed code.
          checks.pinned-compact-compiler-version =
            pkgs.runCommand "check-pinned-compact-compiler-version"
              {
                expected = compactCompilerVersion;
                actual = compact-toolchain.version;
                meta.description = "Asserts the compact-toolchain version matches the pinned compiler version";
              }
              ''
                if [ "$actual" != "$expected" ]; then
                  echo "ERROR: flake-collection compact-toolchain version ($actual) != pin ($expected)" >&2
                  echo "Align the pin in flake.nix and COMPACT_COMPILER_VERSION in .github/workflows/ci.yml." >&2
                  exit 1
                fi
                mkdir -p "$out"
              '';

          checks.npm-artifacts-contents = npmArtifactsContentsCheck;

          devShells.default = pkgs.mkShell {
            packages =
              with pkgs;
              [
                git
                gnutar
                nodejs_24
                turbo
                compact-midnight
                compact-toolchain
              ];

            shellHook = ''
              # Point the `compact` devtool at the pinned toolchain so contract
              # compilation never reaches for a remote download.
              export COMPACT_DIRECTORY=${compact-toolchain}

              # Provide pnpm through corepack so the devshell honors the
              # `packageManager` pin in package.json (pnpm@10.x) instead of a
              # separately tracked version. Shims are installed into a
              # user-writable cache dir and prepended to PATH.
              export COREPACK_HOME="''${COREPACK_HOME:-$HOME/.cache/node/corepack}"
              mkdir -p "$COREPACK_HOME/bin"
              corepack enable --install-directory "$COREPACK_HOME/bin" >/dev/null 2>&1 || true
              export PATH="$COREPACK_HOME/bin:$PATH"

              # Pre-populate the zkir circuit parameters required for offline
              # compact compilation from the flake-collection
              # `midnight-circuit-params` linkFarm. This mirrors the step the
              # `midnight-verifiable-credentials` nix build performs; without
              # it the compiler tries to fetch circuit params over the network.
              mkdir -p "$HOME/.cache/midnight/zk-params"
              cp -r --no-clobber ${midnight-circuit-params}/* "$HOME/.cache/midnight/zk-params/"
            '';
          };

          # Hermetic npm tarballs for downstream consumption; `default` makes a
          # bare `nix build` produce them.
          packages.npm-artifacts = npm-artifacts;
          packages.default = npm-artifacts;
        };
    };
}
