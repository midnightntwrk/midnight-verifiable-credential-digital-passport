// This file is part of midnightntwrk/midnight-verifiable-credential-digital-passport.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { describe, expect, it } from 'vitest';

import { pureCircuits } from '../managed/digital-passport-credential/contract/index.js';
import { createDigitalPassportFixture, signProof } from '../testing/credential-fixtures.js';

setNetworkId('undeployed');

describe('digital-passport credential: age predicate', () => {
  it('checks the private age witness against the committed date of birth', () => {
    const fixture = createDigitalPassportFixture();

    expect(() =>
      pureCircuits.assertValidDigitalPassportAgePredicate(
        fixture.credential,
        fixture.presentation,
        fixture.currentDay,
        fixture.privateParts.claimValues.dateOfBirthDays,
        fixture.privateParts.openings.dateOfBirthOpening,
      ),
    ).not.toThrow();

    expect(() =>
      pureCircuits.assertValidDigitalPassportAgePredicate(
        fixture.credential,
        fixture.presentation,
        fixture.currentDay,
        fixture.privateParts.claimValues.dateOfBirthDays,
        new Uint8Array(32).fill(1),
      ),
    ).toThrow(/Date-of-birth witness does not match credential commitment/);
  });

  it('rejects a predicate proof when the holder is below the requested threshold', () => {
    const fixture = createDigitalPassportFixture();

    const strictPresentation = {
      ...fixture.presentation,
      disclosed: {
        ...fixture.presentation.disclosed,
        ageThresholdYears: 30n,
      },
    };
    const strictPresentationProof = signProof({
      bodyRoot: pureCircuits.digitalPassportPresentationBodyRoot(strictPresentation),
      context: 'presentation',
      signer: fixture.holder,
      createdAt: fixture.presentationProof.createdAt + 1n,
      challengeHash: fixture.presentationProof.challengeHash,
      nonceScalar: 23n,
    });

    expect(() =>
      pureCircuits.assertValidDigitalPassportPresentation(
        fixture.credential,
        fixture.credentialProof,
        strictPresentation,
        strictPresentationProof,
      ),
    ).not.toThrow();

    expect(() =>
      pureCircuits.assertValidDigitalPassportAgePredicate(
        fixture.credential,
        strictPresentation,
        fixture.currentDay,
        fixture.privateParts.claimValues.dateOfBirthDays,
        fixture.privateParts.openings.dateOfBirthOpening,
      ),
    ).toThrow(/Age predicate does not satisfy the requested threshold/);
  });
});
