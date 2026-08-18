# SPDX-License-Identifier: Apache-2.0
#
# Per-publishable-package npm tarball derivation (change
# `npm-artifacts-flake-output`, design D1–D6).
#
# Builds the package's real pipeline and packs it with `pnpm pack`
# (`prepack` → compact compile → tsc build → artifact copies), fully offline:
#   - dependencies resolve from the fixed-output offline store
#     (`nix/pnpm-offline-store.nix`) with `pnpm install --offline
#     --frozen-lockfile --ignore-scripts`;
#   - the Compact compiler comes from the pinned `compact-toolchain` via
#     `COMPACT_DIRECTORY` (same wiring as the dev shell);
#   - the zkir circuit parameters are seeded from the flake's
#     `midnight-circuit-params` linkFarm into `$HOME/.cache/midnight/zk-params`
#     (deref-copied), mirroring the dev-shell shellHook;
#   - node/pnpm are the repository's declared pins (nodejs_24, corepack-pinned
#     pnpm from the root manifest's `packageManager` field).
#
# The result is the tarball `pnpm pack` itself produces — the same artifact the
# CI smoke lane packs — so downstream `nix build` consumers get the publishable
# npm artifact without building the workspace themselves.
{
  lib,
  stdenv,
  nodejs,
  compact-midnight,
  compact-toolchain,
  midnight-circuit-params,
  src,
  offlineStore,
  pkg,
}:

stdenv.mkDerivation {
  pname = "npm-tarball-${pkg.baseName}";
  version = pkg.version;

  inherit src;

  # The `compact` devtool locates the compiler through COMPACT_DIRECTORY; this
  # is the same env the dev shell exports.
  COMPACT_DIRECTORY = compact-toolchain;

  buildInputs = [
    nodejs
    compact-midnight
  ];

  dontUnpack = true;
  dontConfigure = true;
  dontFixup = true;

  buildPhase = ''
    runHook preBuild

    workspace="$NIX_BUILD_TOP/workspace"
    mkdir -p "$workspace"
    cp -R "$src"/. "$workspace"/
    chmod -R u+w "$workspace"
    cd "$workspace"

    # ---- hermetic pnpm (corepack-pinned, provisioned in the offline store)
    export HOME="$NIX_BUILD_TOP/home"
    mkdir -p "$HOME"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    export COREPACK_HOME="$NIX_BUILD_TOP/corepack-home"
    mkdir -p "$COREPACK_HOME/bin"
    cp -R "${offlineStore}/corepack-home"/. "$COREPACK_HOME"/
    chmod -R u+w "$COREPACK_HOME"
    corepack enable --install-directory "$COREPACK_HOME/bin"
    export PATH="$COREPACK_HOME/bin:$PATH"

    # ---- writable copy of the offline dependency store
    storeDir="$NIX_BUILD_TOP/pnpm-store"
    mkdir -p "$storeDir"
    cp -R "${offlineStore}/pnpm-store"/. "$storeDir"/
    chmod -R u+w "$storeDir"
    export npm_config_store_dir="$storeDir"

    # ---- circuit parameters (deref-copy the linkFarm, as the dev shell does)
    mkdir -p "$HOME/.cache/midnight/zk-params"
    cp -RL "${midnight-circuit-params}"/* "$HOME/.cache/midnight/zk-params/"

    # ---- offline install, then the real pack pipeline (runs `prepack`)
    pnpm install --offline --frozen-lockfile --ignore-scripts

    mkdir -p "$out"
    pnpm --filter "${pkg.name}" pack --pack-destination "$out"

    # Guard npm's packing convention: the produced filename must match the
    # name/version discovered at eval time from the package manifest.
    if [ ! -f "$out/${pkg.tarballName}" ]; then
      echo "ERROR: pnpm pack produced an unexpected tarball name for ${pkg.name}" >&2
      echo "expected: ${pkg.tarballName} (from manifest name + version ${pkg.version})" >&2
      echo "produced:" >&2
      ls -l "$out" >&2
      exit 1
    fi

    runHook postBuild
  '';

  meta = {
    description = "Hermetic pnpm pack tarball of ${pkg.name}@${pkg.version}";
  };
}
