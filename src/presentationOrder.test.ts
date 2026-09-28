import { describe, expect, it } from 'vitest'
import {
  customerIdsInCanonicalResidenceOrder,
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
