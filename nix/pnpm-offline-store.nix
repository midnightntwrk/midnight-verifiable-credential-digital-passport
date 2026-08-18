# SPDX-License-Identifier: Apache-2.0
#
# Fixed-output offline dependency fetch for the pnpm workspace (change
# `npm-artifacts-flake-output`, design D2/D6).
#
# Runs `pnpm fetch` against the workspace's `pnpm-lock.yaml` with the
# repository's corepack-pinned pnpm (the `packageManager` field of the root
# manifest — currently pnpm@10.34.1) and produces a content-addressed offline
# store the tarball derivation installs from with
# `pnpm install --offline --frozen-lockfile` — no network in the build phase.
#
# The output carries two things:
#   - `pnpm-store/` — the pnpm store populated from the lockfile
#   - `corepack-home/` — the corepack cache with the pinned pnpm provisioned,
#     so the sandboxed build runs the exact same pnpm without network access
#
# Because this is a fixed-output derivation it may download (that is its only
# job); its recorded hash changes exactly when the lockfile (or the
# `packageManager` pin, both part of `src`) changes, and it is updated
# mechanically when that happens.
{
  lib,
  stdenv,
  nodejs,
  cacert,
}:

{
  # Manifest-only workspace source: root manifests + lockfile + workspace
  # package manifests. Nothing else influences what `pnpm fetch` downloads.
  src,
}:

# When `pnpm-lock.yaml` or the `packageManager` pin changes, refresh this hash
# by building once and copying the `got: sha256-...` value Nix reports.

stdenv.mkDerivation {
  name = "pnpm-offline-store";
  inherit src;

  buildInputs = [ nodejs cacert ];

  outputHashMode = "recursive";
  outputHashAlgo = "sha256";
  outputHash = "sha256-Y6SIYbGvw8ISi+RkAmWq5Yv0X9+EoFRzUtHHZuDG13I=";

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

    # Scratch HOME: anything pnpm/corepack writes outside the store stays OUT
    # of the fixed output, so the hash covers only deterministic content.
    export HOME="$NIX_BUILD_TOP/home"
    mkdir -p "$HOME"

    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    # `corepack pnpm` provisions the version pinned by the root manifest's
    # `packageManager` field into COREPACK_HOME on first use; inside this
    # fixed-output derivation that one-time download is allowed.
    export COREPACK_HOME="$out/corepack-home"
    mkdir -p "$COREPACK_HOME" "$out/pnpm-store"

    corepack pnpm fetch --store-dir "$out/pnpm-store"

    runHook postBuild
  '';
}
