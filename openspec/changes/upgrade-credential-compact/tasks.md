# Tasks — upgrade-credential-compact

## 1. Dependency bump (after 2026-09-25: minimumReleaseAge window lifts)

- [ ] 1.1 Confirm installability: `npm view @midnight-ntwrk/credential-compact@0.2.0-rc1 time --json` shows publish + 7 days elapsed (no `minimumReleaseAgeExclude` entry is to be added)
- [ ] 1.2 Bump `packages/midnight-vc-passport/package.json`: `@midnight-ntwrk/credential-compact` `0.1.0-rc3` → `0.2.0-rc1`
- [ ] 1.3 Refresh the lockfile (`pnpm install` in the devshell) and verify the graph resolves a single `compact-runtime@0.16.0` instance shared by family and core (`pnpm why @midnight-ntwrk/compact-runtime`)

## 2. Local protocol-envelope module (replaces removed core choreography)

- [ ] 2.1 Add `src/digital-passport-credential/protocol-envelope.compact`: `ProtocolMessageEnvelope` struct, `HolderBindingProfile` enum, `CredentialProtocolFeatures` struct, `noProtocolResponseReference()` sentinel, `assertValidProtocolMessageEnvelope`, and `assertProtocolResponseEnvelope` — adapted from the last published core sources with `controllerAddress` naming (design D1/D3)
- [ ] 2.2 Fold the `Issue`/`Present` message structs and alignment circuits into the family's `protocol-model.compact`/`validation.compact`, prefixing as today (`DigitalPassportIssuance_`, `DigitalPassportVerification_`); update `src/digital-passport-credential.compact` to drop the core `Issue`/`Present` imports
- [ ] 2.3 Fix `helpers.compact`: remove the `assertValidNoStatusBinding` call (core dropped the no-op validator; `NoStatusBinding` stays the status profile) and rename `didContractAddress` → `controllerAddress` (design D4/D5)
- [ ] 2.4 Recompile: `pnpm run compact` in the devshell; commit the regenerated `src/managed/**` diff and verify it carries `checkRuntimeVersion('0.16.0')` and the renamed `VerificationMethodRef` shape

## 3. TypeScript consumers

- [ ] 3.1 `src/testing/credential-fixtures.ts`: import `Proof`/`VerificationMethodRef`/`pureCircuits` from the `@midnight-ntwrk/credential-compact` root export; rename fixture `didContractAddress` keys to `controllerAddress`; replace `genericPureCircuits.noProtocolResponseReference()` with the family sentinel (design D2/D5)
- [ ] 3.2 `src/codecs.ts` + `src/test/codecs.test.ts`: rename the encoded field, keep codec round-trip vectors byte-stable at the Compact-value level; update TypeScript-level expectations
- [ ] 3.3 Sweep for stragglers: `grep -rn "didContractAddress\|credential-compact/contract\|noProtocolResponseReference'" packages/ --include='*.ts'` returns nothing outside the new local module
- [ ] 3.4 `packages/smoke-consumer`: run the round-trip smoke; fix any type-level fallout only (no semantic edits expected)

## 4. Verification

- [ ] 4.1 Devshell: `pnpm run all` (compact + build + lint + typecheck + tests) green; record circuit-size/row drift in the PR description
- [ ] 4.2 `package-distribution` delta scenarios: registry-clean manifest (`credential-compact@0.2.0-rc1`), single shared runtime instance, root-export import only, family guard passes — evidenced by 1.3, 2.4, 3.1, 3.4
- [ ] 4.3 Confirm no version-mismatch or dual-runtime paths remain: no `0.15.0` resolution anywhere in `pnpm-lock.yaml`

## 5. Docs and changelog

- [ ] 5.1 Root README: `credential-compact@0.1.0-rc3` → `0.2.0-rc1`; drop/rewrite dual-runtime mentions
- [ ] 5.2 Package README + CHANGELOG: dependency versions; a `Changed` entry noting the core bump, the `controllerAddress` rename, locally-owned protocol envelope module, and the new fail-closed core invariants consumers must respect (empty controller address, schema-matched presentations, canonical body-root validation)
- [ ] 5.3 `docs/monorepo-deletion-criteria.md`: refresh the satisfied-criterion version reference (rc3 → 0.2.0-rc1)
- [ ] 5.4 `docs/security/digital-passport-threat-model.md`: update the runtime-stack sentence if it names version-specifics
- [ ] 5.5 `openspec validate --changes` passes; PR description records the upstream 0.2.0 changelog highlights relevant to consumers
