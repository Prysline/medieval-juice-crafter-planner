import { describe, expect, it } from 'vitest'
import type { PreparationShortfall } from './preparationShortfall'
import { buildPurchaseDecisions } from './purchaseSources'

function shortfall(
  ingredientId: string,
  name: string,
  purchaseUnits: number,
): PreparationShortfall {
  return {
    recipes: [],
    ingredients: [
      {
        ingredientId,
        name,
        requiredUnits: purchaseUnits,
        inventoryUnitsAvailable: 0,
        inventoryUnitsUsed: 0,
        purchaseUnits,
      },
    ],
    productionWaterUnitsRequired: 0,
    waterUnitsAvailable: 0,
    waterUnitsUsed: 0,
    waterUnitsToFetch: 0,
    cleanCupUses: 0,
    cleanCupsAvailable: 0,
    cleanCupShortfallBeforeWashing: 0,
    usedCupsAvailable: 0,
  }
}

describe('purchase source decisions', () => {
  it('selects a unique cheapest known source when no price tie exists', () => {
    const [decision] = buildPurchaseDecisions(
      shortfall('mint', '薄荷', 2),
      'seasoner-unlocked',
    )

    expect(decision).toMatchObject({
      ingredientId: 'mint',
      quantity: 2,
      cheapestUnitPrice: 14,
      cheapestSourceIds: ['canonical:mint'],
      selectedSourceId: 'canonical:mint',
      status: 'unique-cheapest',
      minimumEstimatedCost: 28,
    })
  })

  it('preserves equal-price seller options instead of inventing a route tie-break', () => {
    const [decision] = buildPurchaseDecisions(
      shortfall('lemon', '檸檬', 3),
      'tranquil-fountain-unlocked',
    )

    expect(decision.cheapestUnitPrice).toBe(9)
    expect(decision.status).toBe('price-tie')
    expect(decision.selectedSourceId).toBeNull()
    expect(decision.cheapestSourceIds).toEqual(
      expect.arrayContaining([
        'canonical:lemon',
        'shop:tranquil-fountain-produce-merchant',
      ]),
    )
    expect(decision.minimumEstimatedCost).toBe(27)
  })

  it('does not expose future-region shop options before their milestone', () => {
    const [decision] = buildPurchaseDecisions(
      shortfall('lemon', '檸檬', 1),
      'seasoner-unlocked',
    )

    expect(decision.sourceOptions.map((source) => source.sourceId)).toEqual([
      'canonical:lemon',
    ])
    expect(decision.status).toBe('unique-cheapest')
  })

  it('reports an unknown stale ingredient without inventing a seller', () => {
    const [decision] = buildPurchaseDecisions(
      shortfall('future-item', '未知原料', 1),
      'tranquil-fountain-unlocked',
    )

    expect(decision).toMatchObject({
      sourceOptions: [],
      cheapestUnitPrice: null,
      cheapestSourceIds: [],
      selectedSourceId: null,
      status: 'no-known-source',
      minimumEstimatedCost: null,
    })
  })
})
