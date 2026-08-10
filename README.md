# midnight-verifiable-credential-digital-passport

The standalone home of the **digital-passport verifiable credential family** for
Midnight. This is the first credential family to graduate out of the
[`midnight-verifiable-credentials`](https://github.com/midnightntwrk/midnight-verifiable-credentials)
monorepo into an independent repository with its own ownership, versioning, and
release train. Consumers install it as a normal npm package; there is no
source-level coupling to the monorepo.

- **Head package:** [`@midnight-ntwrk/midnight-verifiable-credential-digital-passport`](packages/midnight-verifiable-credential-digital-passport)
  — the credential family: five committed claims, selective disclosures, an
  age-over-threshold predicate, presentation requests, validation circuits,
  explicit holder binding, no-status binding, and the protocol model.
- **On-chain identifiers** (unchanged by the package rename): `midnight:vc:digital-passport`
  and `digital-passport:v1`.
- **Status:** `reference` maturity. The package manifest is publishable; the
  first registry release is cut by a separate release change.

## Repository layout

```
packages/
  midnight-verifiable-credential-digital-passport/   # the credential family (publishable-ready)
  smoke-consumer/                                    # private consumer boundary evidence
flake.nix                                            # dev shell: Node, pnpm, Compact toolchain, circuit params
turbo.json                                           # lint / typecheck / build / test / smoke pipeline
```

It is a pnpm + turbo workspace (`packages/*`), mirroring the
[`midnight-did`](https://github.com/midnightntwrk/midnight-did) precedent. The
family package depends only on registry-resolvable semver packages — published
[`@midnight-ntwrk/compact-runtime`](https://www.npmjs.com/package/@midnight-ntwrk/compact-runtime)
and the published contract layer
[`@midnight-ntwrk/credential-compact`](https://www.npmjs.com/package/@midnight-ntwrk/credential-compact)
(the generic VC/VP core from the `credential-*` core split). The generic
Compact-value wire codec is inlined into the family package (no dependency on
the monorepo's openid transport package).

## Development

The reproducible toolchain lives in the Nix flake, which provides Node.js 24,
pnpm (via Corepack, honoring the `packageManager` pin), the Compact compiler
(**0.30.0**, identical to the CI pin), and pre-populated Midnight circuit
parameters for offline compilation.

```sh
nix develop            # enter the dev shell (toolchain + circuit params ready)
pnpm install           # install workspace dependencies
pnpm run all           # lint && typecheck && build && test:ci (turbo pipeline)
```

Other useful tasks: `pnpm run smoke` (consumer boundary round-trip),
`pnpm run clean`, `pnpm --filter @midnight-ntwrk/midnight-verifiable-credential-digital-passport test`.

> **Published-core note:** the family's core contract dependency
> `@midnight-ntwrk/credential-compact@0.1.0-rc3` is published to npm alongside
> `@midnight-ntwrk/compact-runtime@0.15.0`. The manifest is strictly
> registry-clean — there is no `pnpm.overrides`, no `.core-rc/`, and no `file:`
> override anywhere — so local build/typecheck/test and the consumer smoke all
> resolve from the registry. See the package
> [README](packages/midnight-verifiable-credential-digital-passport/README.md)
> and [design](openspec/changes/extract-digital-passport-credential/design.md) for details.

## Continuous integration

- [`ci.yml`](.github/workflows/ci.yml) — the full contract lane (typecheck,
  lint, build, test) plus the consumer smoke round-trip. The `verify` and `smoke`
  jobs are un-gated and run on every push/PR (`credential-compact` is published,
  so there is no `rc-gate` job); security-hygiene lanes always run.
- [`dependency-review.yml`](.github/workflows/dependency-review.yml),
  [`scorecard.yml`](.github/workflows/scorecard.yml),
  [`scan.yaml`](.github/workflows/scan.yaml) — supply-chain security hygiene.

## Boundary handoff

This repository is the source of truth for the family. The duplicate in the
`midnight-verifiable-credentials` monorepo is frozen migration evidence until a
separate change in that repository deletes it. The criteria authorizing that
deletion are recorded in
[`docs/monorepo-deletion-criteria.md`](docs/monorepo-deletion-criteria.md).

## Related repositories

- [midnight-verifiable-credentials](https://github.com/midnightntwrk/midnight-verifiable-credentials)
  — the generic VC/VP core (now published as `@midnight-ntwrk/credential-compact`
  from the `credential-*` core split) and the extraction source; see the
  [core credentials package](https://github.com/midnightntwrk/midnight-verifiable-credentials/blob/develop-history-2026-08-06/packages/core/primitives/credentials/README.md).
- [midnight-did](https://github.com/midnightntwrk/midnight-did) — the
  pnpm + turbo + flake + CI precedent this repository mirrors.

## License

Apache 2.0 — see [LICENSE](LICENSE).
