## 1. Manifest and workspace rename

- [ ] 1.1 `git mv packages/midnight-verifiable-credential-digital-passport packages/midnight-vc-passport`
- [ ] 1.2 Update `packages/midnight-vc-passport/package.json`: `name` → `@midnight-ntwrk/midnight-vc-passport`, `repository.directory` → `packages/midnight-vc-passport`
- [ ] 1.3 Update pnpm workspace globs / lockfile references if any path mentions the old directory; run `pnpm install` to regenerate

## 2. Consumer and tooling references

- [ ] 2.1 Update `packages/smoke-consumer/scripts/round-trip.mjs` import specifiers (root, `/codecs`, `/contract`, `/testing`)
- [ ] 2.2 Update `FAMILY` constant in `packages/smoke-consumer/scripts/smoke.mjs` and `tooling/scripts/test-release-package-consumers.mjs`
- [ ] 2.3 Update `tooling/scripts/publish-npm-packages.sh` and `tooling/scripts/wait-for-npm-packages.mjs` where they name the package
- [ ] 2.4 Grep the live tree (excluding `openspec/changes/archive/` and CHANGELOG history sections) for `midnight-verifiable-credential-digital-passport` and fix every npm-package-name occurrence that is not a repository/SPDX reference

## 3. Docs and metadata

- [ ] 3.1 Update root `README.md`, `packages/midnight-vc-passport/README.md`, package `CHANGELOG.md` (unreleased entry noting the rename), `docs/guides/npmjs-publication.md`, `docs/security/digital-passport-threat-model.md`
- [ ] 3.2 Confirm SPDX headers are untouched (they name the repository, not the package)

## 4. Spec coherence

- [ ] 4.1 Rebase this change onto `develop` after `npm-trusted-publishing` has archived; verify the MODIFIED block in `specs/npm-publication/spec.md` still matches the archived base requirement text (refresh the package name swap if the text differs)
- [ ] 4.2 `openspec validate rename-npm-package` passes
- [ ] 4.3 Confirm base `openspec/specs/package-distribution/spec.md` "Package identity" requirement is the only other live-spec reference needing sync at archive time

## 5. Release prerequisites (owner actions, outside the repo)

- [ ] 5.1 npm organization owners create the Trusted Publisher mapping for `@midnight-ntwrk/midnight-vc-passport` (org `midnightntwrk`, repo `midnight-verifiable-credential-digital-passport`, workflow `publish.yml`, environment `npm-release`) before first dispatch — runbook prerequisite section already names this action generically
- [ ] 5.2 Verify name availability once more immediately before first publish (scoped names cannot be squatted by outsiders, but a sibling package inside the org could collide)

## 6. Verification

- [ ] 6.1 Run the consumer smoke lane (pack → isolated install → import every entry point → fixture round-trip) against the renamed package
- [ ] 6.2 Run repository validation: `openspec validate`, policy/lint checks, flake checks if the `npm-artifacts` build references package paths
