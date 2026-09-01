# npmjs publication runbook

This is the operator runbook for publishing
`@midnight-ntwrk/midnight-verifiable-credential-digital-passport` to the public
npm registry. It is adapted from the sibling
[`midnight-verifiable-credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials)
publication runbook, reduced to this repository's single publishable package.

Publication is **manual-dispatch only**: the
[`publish.yml`](../../.github/workflows/publish.yml) workflow is the single
door to the registry, and the first thing it does — before any build, pack, or
publish step — is validate the channel/branch gate
(`tooling/scripts/release-resolve-context.sh`):

| Channel   | Allowed branches      | Version scheme                          | npm dist-tag |
| --------- | --------------------- | --------------------------------------- | ------------ |
| `snapshot`| `develop` only        | `<base>-snapshot.<run>.<short-sha>`      | `snapshot`   |
| `rc`      | `develop` or `main`   | `<base>-rc<N>`                           | `rc`         |
| `release` | `main` only           | `<base>`                                 | `latest`     |

Versioning is **stateless**: the base semver (`0.1.0`) lives in the root and
package manifests (they must agree, and the workflow fails if they don't); the
workflow stamps the channel version only into its ephemeral checkout. Nothing
is committed, tagged, or pushed by a publication.

> **Temporary distribution bridge (active):** while the
> `MIDNIGHTCI_NPMJS_TOKEN` grant is unavailable, the registry publication
> steps below are suspended and the workflow distributes through GitHub
> Releases instead. See
> [Temporary distribution bridge](#temporary-distribution-bridge-github-releases)
> for the dispatch procedure, the rerun/rollback rules, and the exit
> condition. Everything else in this runbook (ownership, channels, gating,
> stateless versioning, pre-dispatch checks) stays in force unchanged.

## Temporary distribution bridge (GitHub Releases)

**BRIDGE (temporary).** The npmjs token grant is blocked outside this
repository's control, so the publication workflow currently attaches the
gated, contract-checked tarball to a GitHub Release instead of publishing to
the npmjs registry. npmjs remains the sole eventual target — the bridge
deliberately introduces no second registry (GitHub Packages was rejected to
avoid a second confusing registry target). Consumers install by versioned
release URL; see the "Installing from GitHub Releases" sections of the root
and package READMEs.

### What the bridged run does

The suspended steps (npm CLI trusted-publishing check, dist-tag snapshot,
npm publish, propagation wait, dist-tag verification, registry-mode consumer
test) remain in `publish.yml` in commented form with restore instructions;
`NPM_REGISTRY` stays locked to `https://registry.npmjs.org/` (the dependency
source during install); and the run instead:

1. resolves and gates the publication context exactly as before
   (dispatch-only; `snapshot` fails closed with a bridge-specific message —
   run-number-stamped snapshot versions cannot be pre-tagged by an operator),
2. reconciles the operator-supplied release tag before any build step,
3. re-runs the full repository gate and the smoke round-trip,
4. stamps the version statelessly, packs + contract-checks + consumer-tests
   the tarballs (the contract check additionally emits
   `tooling/artifacts/contract-report.json`), and generates the SPDX SBOMs,
5. uploads the 90-day release-evidence artifact (tarballs + SBOMs + the
   contract report),
6. writes SHA256SUMS over the tarball/SBOM/contract report, creates the
   release on the operator tag with every asset and a generated body
   (channel, version, install URL, checksums, verification one-liners,
   changelog link) — `rc` creates a **prerelease (never latest)**, `release`
   creates the **latest** release — and verifies every uploaded asset digest
   against the packed bytes,
7. attests every uploaded asset (build provenance), and
8. runs a clean-consumer install from the just-created release's download
   URL (dependencies resolve from the public npmjs registry).

### Dispatch procedure (bridge)

1. Confirm every pre-dispatch gate above (CI green on the dispatch branch,
   catalog tight, manifests and changelogs current). The token check does not
   apply during the bridge.
2. Create and push the release tag on the commit you will dispatch from
   (the release commit):

   ```sh
   git tag v0.1.0-rc1            # on the release commit
   git push origin v0.1.0-rc1
   ```

3. On the **Actions** tab, choose **Publish** → **Run workflow**:
   - **Branch:** `develop` (rc) or `main` (release)
   - **Channel:** `rc` or `release` (`snapshot` is rejected during the bridge)
   - **Tag:** the tag you pushed (`v0.1.0-rc1`)
   - **Version:** the manifest base (optional confirmation)
   - **rc_index:** e.g. `1` (rc channel only; defaults to 1)
4. Watch the run. Expected sequence: context resolution → tag reconciliation
   → tool setup → full gate → smoke round-trip → version preparation → pack
   + contract check + tarball consumer test → SBOMs → evidence artifact →
   sums + body → release creation → digest verification → attestations →
   release-URL consumer test → summary.

### Tag and `rc_index` reconciliation rules

The run fails **before any build step** unless the supplied tag:

- exists in the repository (pushed, not just local),
- points at the commit the dispatch was made from (`github.sha`), and
- equals `v<resolved-full-version>` — for `rc`, `<base>-rc<rc_index>` with
  `rc_index` defaulting to `1`; for `release`, exactly `v<base>`.

Typical mismatches: tag `v0.1.0-rc2` with `rc_index` left at its default `1`
(fails with the expected tag in the message), a tag on a commit other than
the dispatch HEAD, or a forgotten `git push` of the tag. The workflow itself
never creates, moves, or deletes any ref; the manifests keep the base
version after publication (statelessness is preserved).

### Rerun, rollback, and failure handling

- **Rerun after a success (no-op):** re-dispatching the same channel, tag,
  version, and index succeeds as an **idempotent no-op** — the run verifies
  every existing asset digest against the freshly packed artifacts and skips
  re-creation. This is the safe answer to "did it finish?".
- **Partial asset upload:** a rerun uploads only the missing assets; existing
  assets are never overwritten (`--clobber` is never used).
- **Digest drift on an existing release:** the run fails closed. Delete the
  failed release (`gh release delete <tag> --yes`) or re-dispatch the
  corrected publication; delete the tag itself only when it is wrong.
- **Failed release-URL consumer round-trip:** the run fails after the release
  became visible. Delete the failed release so no release whose URL-installed
  package failed the round-trip remains published, fix the cause, and
  re-dispatch.
- **Rollback (any time):** the bridge is additive to git history — reverting
  the change's commits restores the npm path verbatim; existing releases
  remain as inert artifacts until deleted by an admin.

### Integrity evidence and residual risk

Every release carries the tarball, SHA256SUMS, the SPDX SBOM, and the
contract report; every uploaded asset carries a build-provenance
attestation (verify with `gh attestation verify --repo
midnightntwrk/midnight-verifiable-credential-digital-passport <asset-file>`).
The 90-day release-evidence artifact is retained as before. Residual risk:
a repository admin can replace a release asset's bytes at the pinned URL —
accepted for the bridge window; attestation verification makes replacement
detectable, and tag-deletion rulesets are recommended where the org permits.

### Bridge exit condition

Once the npm automation token is available and the first **`release`-channel
npmjs publication succeeds, a **single follow-up change** ends the bridge: it
uncomments the suspended npmjs steps and the `NODE_AUTH_TOKEN` env, removes
the bridge steps and the `tag` workflow input, restores the workflow
permissions to `contents: read` + `id-token: write`, restores the scoped
`npm-publication` and `repository-toolchain` requirements to their
unconditional form, removes the `github-release-distribution` capability,
and updates the consumer documentation — returning npmjs to the sole
distribution channel. Until that exit, the bridge is the documented
publication path; it must not silently persist as a second channel.

## Ownership

| Concern                          | Owner                        |
| -------------------------------- | ---------------------------- |
| Technical (workflow, scripts, release decisions) | `@midnightntwrk/ex-identus` |
| Credentials, dispatch, incidents | `@midnightntwrk/mn-sre`      |
| Security escalation              | `@midnightntwrk/mn-security` |

CODEOWNERS routes the release surface (workflow, scripts, this guide) to all
three teams: changes to the publication path require their review.

## Authentication and token policy

- The workflow authenticates with the org automation token stored as the
  repository secret **`MIDNIGHTCI_NPMJS_TOKEN`** (the sibling repositories use
  the same path).
- The token should be a **granular access token** with *read and write*
  permissions on packages in the `@midnight-ntwrk` scope, configured to
  **bypass two-factor authentication** (automation tokens cannot complete
  interactive 2FA). For the first publication it must also carry the right to
  **create new packages** in the `@midnight-ntwrk` organization.
- The token is consumed through the environment (`NODE_AUTH_TOKEN`) and the
  `.npmrc` written by `setup-node` — **never** through workflow inputs,
  command arguments, repository files, or logs. The publish script refuses to
  run without it and the registry is hard-locked to
  `https://registry.npmjs.org/`.
- **Future OIDC migration:** the workflow verifies in every run that the
  installed npm CLI supports trusted publishing (npm ≥ 11.5.1), so moving to
  npm OIDC trusted publishing (dropping the token entirely) is a config
  change, not a workflow rewrite. Removing the token is a future org-policy
  step.
- The publication itself runs with `id-token: write` (npm provenance) and
  `contents: read` only; checkouts persist no credentials — both enforced by
  the CI self-check (`check:security-workflows`).

## Pre-dispatch gates

Before dispatching any publication, verify:

1. **Secret present:** `MIDNIGHTCI_NPMJS_TOKEN` exists on the repository
   (Settings → Secrets and variables → Actions) and is current. The workflow
   fails before publishing if it is absent.
2. **CI green** on the branch you will dispatch from (`develop` for `rc` /
   `snapshot`, `main` for `release`) — the publish run re-runs the full gate
   itself, but a red CI lane means the dispatch will waste a run and fail.
3. **Catalog is tight:** `node tooling/scripts/workspace-catalog.mjs
   --publishable-paths` prints exactly
   `packages/midnight-verifiable-credential-digital-passport`. If any other
   workspace appears, stop and fix the catalog first — private evidence
   workspaces (e.g. the smoke consumer) must never be publishable.
4. **Version and changelog current:** the root and family package manifests
   carry the same base version (`0.1.0` until the first bump), and the
   `[Unreleased]` sections of both changelogs reflect what is being released.
   A supplied `version` input must equal the manifest base — the manifests are
   the source of truth (stateless versioning).

## First release (dispatch procedure)

The first publication creates the package in the `@midnight-ntwrk` org:

1. Confirm every pre-dispatch gate above.
2. On the **Actions** tab, choose **Publish** → **Run workflow**:
   - **Branch:** `develop`
   - **Channel:** `rc`
   - **Version:** `0.1.0`
   - **rc_index:** `1`
3. Dispatch and watch the run. Expected sequence: context resolution → tool
   setup → npm CLI check → full gate (`pnpm run all`) → smoke round-trip →
   version preparation (`0.1.0-rc1`, stamped only into the ephemeral checkout)
   → pack + contract check + tarball consumer test → SPDX SBOMs → dist-tag
   snapshot → evidence artifact upload → publish with provenance →
   propagation wait → dist-tag verification → registry-mode consumer test →
   summary. Note: on the very first publication of the package the npmjs
   registry automatically sets `latest` to the published version even with
   `--tag rc` (npm behavior; see the `@midnight-ntwrk/credential-model`
   precedent). The dist-tag verification tolerates this for a
   never-before-published package; `latest` will keep pointing at the newest
   rc until the first `release` dispatch moves it to a stable version.
4. Any step failing means **nothing was published** unless the failure is
   after the publish step; versions are immutable, so a partial failure before
   publish is always safe to re-dispatch.

## Post-publication verification

After a green run:

```sh
npm view @midnight-ntwrk/midnight-verifiable-credential-digital-passport --json
npm view @midnight-ntwrk/midnight-verifiable-credential-digital-passport dist-tags
npm view @midnight-ntwrk/midnight-verifiable-credential-digital-passport@0.1.0-rc1 dist.attestations
```

Confirm:

- the version is **public** on npmjs (no `private: true` masking),
- the dist-tag matches the channel (`rc` for `0.1.0-rc1`) and **`latest`
  still points at the previous stable release** — with one exception: on the
  very first publication of the package, npmjs automatically sets `latest`
  to the published version even when publishing with a non-latest dist-tag,
  so until the first `release` dispatch, `latest` legitimately points at the
  newest rc,
- the **provenance attestation** is present (published with `--provenance`),
- the release-evidence artifact (tarballs, SBOMs, dist-tag snapshot) is
  attached to the workflow run,
- a clean install works from the registry:
  `npm install @midnight-ntwrk/midnight-verifiable-credential-digital-passport@0.1.0-rc1`
  (the workflow already ran this check from the registry).

Finally, record the release: add the install instructions with the live
version to the README and move the `[Unreleased]` entries to the released
version in the package and root changelogs.

## Retry and rollback

- **Retry after a failure before publish:** re-dispatch with the same inputs.
  Nothing was published; the run starts fresh.
- **Retry after a success (no-op):** re-dispatching the same channel, version,
  and index succeeds as an **idempotent no-op** — the publish script detects
  the already-published version, verifies the dist-tag, and skips
  republishing. This is the safe answer to "did it finish?".
- **Drifted dist-tag:** if a dist-tag points at the wrong version (e.g. `rc`
  left on an older rc), re-dispatch the same inputs — the script **repairs**
  the tag (`npm dist-tag add <name>@<version> <tag>`) instead of republishing.
  Manual repair also works: `npm dist-tag add @midnight-ntwrk/midnight-verifiable-credential-digital-passport@<version> <tag>`.
- **A bad version is live:** npm versions are immutable. Within 72 hours of
  publication, `npm unpublish` the exact version (org policy permitting);
  otherwise deprecate it (`npm deprecate <name>@<version> "message"`) and cut
  the next rc/stable. Never move `latest` onto an untested version — repair
  tags only with versions the pipeline published and verified.

## Incident response

1. **Suspected token compromise:** revoke `MIDNIGHTCI_NPMJS_TOKEN` in the npm
   org immediately, rotate the repository secret, and page
   `@midnightntwrk/mn-sre`.
2. **Audit:** list recent versions and publish times
   (`npm view <name> time --json`), cross-check against the GitHub Actions
   publication runs (each has an evidence artifact), and confirm provenance
   attestations cover every published version.
3. **Escalation:** involve `@midnightntwrk/mn-security` for anything
   confirmed malicious (unexpected versions, moved `latest`, attestation
   anomalies). Freeze publications by revoking the token — dispatch-only
   publication means no automation can publish while the token is dead.
4. **Post-incident:** file the incident per org process; if the root cause is
   in this pipeline, fix it in a PR reviewed by the CODEOWNERS teams before
   re-enabling publication.
