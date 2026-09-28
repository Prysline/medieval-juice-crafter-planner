import { describe, expect, it } from 'vitest'
import {
  customerIdsInCanonicalResidenceOrder,
  customerResidencePresentationGroups,
  customerResidencePresentationLabel,
  sortedByNaturalPresentationId,
} from './presentationOrder'

describe('presentation order', () => {
  it('sorts physical jar identifiers using natural numeric order', () => {
    expect(
      sortedByNaturalPresentationId(
        ['jar-10', 'jar-2', 'jar-1'],
        (id) => id,
      ),
    ).toEqual(['jar-1', 'jar-2', 'jar-10'])
  })

  it('uses canonical customer game order only inside the same residence slots', () => {
    expect(
      customerIdsInCanonicalResidenceOrder([
        'zenobia',
        'eric',
        'lizzie',
        'harry',
      ]),
    ).toEqual([
      'harry',
      'eric',
      'lizzie',
      'zenobia',
    ])
  })

  it('leaves customers without a shared confirmed residence in their original slots', () => {
    expect(
      customerIdsInCanonicalResidenceOrder([
        'florida',
        'jack',
        'savius',
      ]),
    ).toEqual([
      'florida',
      'jack',
      'savius',
    ])
  })
})


describe('residence presentation groups', () => {
  it('groups confirmed residences by first appearance and preserves canonical order inside each residence', () => {
    expect(
      customerResidencePresentationGroups([
        'zenobia',
        'betsy',
        'harry',
        'lizzie',
      ]),
    ).toEqual([
      {
        residenceId: 'east-harbor-residence-8',
        customerIds: ['harry', 'lizzie', 'zenobia'],
      },
      {
        residenceId: 'east-harbor-residence-9',
        customerIds: ['betsy'],
      },
    ])
  })

  it('never merges customers whose residence is unknown', () => {
    expect(
      customerResidencePresentationGroups(
        ['a', 'b', 'c'],
        {
          a: null,
          b: null,
          c: 'test-residence',
        },
      ),
    ).toEqual([
      { residenceId: null, customerIds: ['a'] },
      { residenceId: null, customerIds: ['b'] },
      { residenceId: 'test-residence', customerIds: ['c'] },
    ])
  })

  it('uses the confirmed residence number as the player-facing label', () => {
    expect(
      customerResidencePresentationLabel('east-harbor-residence-8'),
    ).toBe('住處 8')
    expect(customerResidencePresentationLabel(null)).toBeNull()
  })
})
