# SPDX-License-Identifier: Apache-2.0
#
# This repository's reproducible development shell. It mirrors the proven
# mechanism used by the `midnight-verifiable-credentials` monorepo: the
# `midnight-did` flake input supplies the pinned Compact toolchain and the
# pre-built Midnight circuit parameters, which together let the
# `digital-passport-credential` compact contract compile fully offline (no
# network access beyond the flake inputs).
#
# The Compact compiler version is pinned to a single source of truth
# (`compactCompilerVersion` below). The `pinned-compact-compiler-version`
# check fails the build if the toolchain ever drifts away from it, and the CI
# lane (`.github/workflows/ci.yml`) pins the same version for the setup-compact
# action. See the `repository-toolchain` spec ("Pinned Compact toolchain").
{
  description = "Midnight verifiable credential: digital passport — development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    # Provides `compact-toolchain`, `compact-midnight`, and
    # `midnight-circuit-params` — the same inputs the monorepo consumes to
    # compile this contract family offline.
    midnight-did.url = "github:midnightntwrk/midnight-did";
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        { system, ... }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };

          # Compact compiler pin — single source of truth. MUST agree with the
          # CI lane (`COMPACT_COMPILER_VERSION` in ci.yml) and with the version
          # published by the midnight-did flake's `compact-toolchain`.
          compactCompilerVersion = "0.30.0";

          # Toolchain and circuit parameters come from the midnight-did flake so
          # this repo does not duplicate the compiler packaging. `compactc`,
          # `fixup-compact`, and `format-compact` are under `compact-toolchain`;
          # the `compact` devtool (which reads `COMPACT_DIRECTORY` and invokes
          # the compiler) is `compact-midnight`.
          inherit (inputs.midnight-did.packages.${system})
            compact-midnight
            compact-toolchain
            midnight-circuit-params;
        in
        {
          _module.args.pkgs = pkgs;

          # Enforce the compiler pin at build time. If midnight-did ever ships a
          # different compact-toolchain version, `nix flake check` (and any
          # build consuming this output) fails loudly instead of silently
          # producing divergent managed code.
          checks.pinned-compact-compiler-version =
            pkgs.runCommand "check-pinned-compact-compiler-version"
              {
                expected = compactCompilerVersion;
                actual = compact-toolchain.version;
                meta.description = "Asserts the compact-toolchain version matches the pinned compiler version";
              }
              ''
                if [ "$actual" != "$expected" ]; then
                  echo "ERROR: midnight-did compact-toolchain version ($actual) != pin ($expected)" >&2
                  echo "Align the pin in flake.nix and COMPACT_COMPILER_VERSION in .github/workflows/ci.yml." >&2
                  exit 1
                fi
                mkdir -p "$out"
              '';

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
              # compact compilation. This is the exact step the monorepo's nix
              # build performs (`cp -r ${midnight-circuit-params}/*
              # $HOME/.cache/midnight/zk-params/`); without it the compiler
              # tries to fetch circuit params over the network.
              mkdir -p "$HOME/.cache/midnight/zk-params"
              cp -r --no-clobber ${midnight-circuit-params}/* "$HOME/.cache/midnight/zk-params/"
            '';
          };
        };
    };
}
