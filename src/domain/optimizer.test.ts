import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
import { customers as canonicalCustomers } from '../data/customers'
import { optimizeBatchPlan } from './optimizer'
import type { OptimizationRequest } from './optimizerModel'

function customer(
  id: string,
  preference: string,
): Customer {
  return {
    id,
    name: id.toUpperCase(),
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: preference }],
  }
}

function recipe(
  id: string,
  ingredients: string[],
  effects: string[],
  salePrice: number | null = 10,
): RecipeCandidate {
  return {
    id,
    name: id,
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice,
    ingredients,
    effects: effects.map((name, index) => ({
      name,
      value: 5 - index,
    })),
    equipment: [],
  }
}

function request(
  customerIds: string[],
  objective: OptimizationRequest['objective'] = 'minimum-cost',
  formalCustomerIds: string[] = customerIds,
): OptimizationRequest {
  return {
    customerIds,
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
    },
    formalCustomerIds,
    candidatePolicy: 'observed-only',
    objective,
  }
}

describe('batch optimizer', () => {
  it('serves two customers sharing one recipe with one batch', async () => {
    const result = await optimizeBatchPlan(
      request(['a', 'b']),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '清新口氣'),
          ],
          candidates: [
            recipe(
              'shared',
              ['檸檬', '糖', '薄荷'],
              ['甜味', '清新口氣'],
            ),
          ],
        },
      },
    )

    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].customerIds.sort()).toEqual(['a', 'b'])
    expect(result.batches[0].ingredientIds).toEqual([
      'lemon',
      'sugar',
      'mint',
    ])
    expect(result.assignedServings).toBe(2)
    expect(result.producedServings).toBe(2)
    expect(result.leftoverServings).toBe(0)
  })

  it('chooses a shared batch when per-customer cheapest recipes cost more in total', async () => {
    const result = await optimizeBatchPlan(
      request(['a', 'b']),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '清新口氣'),
          ],
          candidates: [
            recipe('a-only', ['檸檬', '糖'], ['甜味']),
            recipe('b-only', ['檸檬', '薄荷'], ['清新口氣']),
            recipe(
              'shared',
              ['檸檬', '糖', '薄荷'],
              ['甜味', '清新口氣'],
            ),
          ],
        },
      },
    )

    expect(result.totalIngredientCost).toBe(30)
    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].recipeId).toBe('shared')
  })

  it('reports one leftover serving for an odd number of assigned customers', async () => {
    const result = await optimizeBatchPlan(
      request(['a', 'b', 'c']),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '甜味'),
            customer('c', '甜味'),
          ],
          candidates: [
            recipe('sweet', ['檸檬', '糖'], ['甜味']),
          ],
        },
      },
    )

    expect(result.batches).toHaveLength(2)
    expect(result.assignedServings).toBe(3)
    expect(result.producedServings).toBe(4)
    expect(result.leftoverServings).toBe(1)
  })

  it('minimum-cost and minimum-waste can choose different valid plans', async () => {
    const customers = [
      customer('a', '酸味'),
      customer('b', '增強免疫'),
      customer('c', '甜味'),
    ]
    const candidates = [
      recipe('a-only', ['檸檬'], ['酸味']),
      recipe('b-only', ['橙子'], ['增強免疫']),
      recipe('c-only', ['檸檬', '糖'], ['甜味']),
      recipe(
        'ab-shared',
        ['檸檬', '橙子', '糖'],
        ['酸味', '增強免疫'],
      ),
    ]

    const cheapest = await optimizeBatchPlan(
      request(['a', 'b', 'c'], 'minimum-cost'),
      { source: { customers, candidates } },
    )
    const leastWaste = await optimizeBatchPlan(
      request(['a', 'b', 'c'], 'minimum-waste'),
      { source: { customers, candidates } },
    )

    expect(cheapest.totalIngredientCost).toBe(36)
    expect(cheapest.batches).toHaveLength(3)
    expect(cheapest.leftoverServings).toBe(3)

    expect(leastWaste.totalIngredientCost).toBe(43)
    expect(leastWaste.batches).toHaveLength(2)
    expect(leastWaste.leftoverServings).toBe(1)
  })

  it('maximum-known-revenue and maximum-known-gross-profit can choose different plans', async () => {
    const source = {
      customers: [customer('a', '甜味')],
      candidates: [
        recipe(
          'high-revenue',
          ['檸檬', '薄荷'],
          ['甜味'],
          40,
        ),
        recipe(
          'high-profit',
          ['檸檬'],
          ['甜味'],
          30,
        ),
      ],
    }

    const revenue = await optimizeBatchPlan(
      request(['a'], 'maximum-known-revenue'),
      { source },
    )
    const profit = await optimizeBatchPlan(
      request(['a'], 'maximum-known-gross-profit'),
      { source },
    )

    expect(revenue.batches[0].recipeId).toBe('high-revenue')
    expect(revenue.knownSalesRevenue).toBe(40)
    expect(revenue.totalIngredientCost).toBe(23)
    expect(revenue.knownGrossProfit).toBe(17)

    expect(profit.batches[0].recipeId).toBe('high-profit')
    expect(profit.knownSalesRevenue).toBe(30)
    expect(profit.totalIngredientCost).toBe(9)
    expect(profit.knownGrossProfit).toBe(21)
  })

  it('keeps potential trials outside known sales revenue', async () => {
    const result = await optimizeBatchPlan(
      request(
        ['a'],
        'maximum-known-revenue',
        [],
      ),
      {
        source: {
          customers: [customer('a', '甜味')],
          candidates: [
            recipe('cheap', ['檸檬'], ['甜味'], 10),
            recipe('expensive', ['檸檬', '薄荷'], ['甜味'], 40),
          ],
        },
      },
    )

    expect(result.batches[0].recipeId).toBe('cheap')
    expect(result.formalSalesCount).toBe(0)
    expect(result.potentialTrialCount).toBe(1)
    expect(result.knownSalesRevenue).toBe(0)
    expect(result.knownGrossProfit).toBe(-9)
  })

  it('reports known revenue metrics in cost mode without changing the primary objective', async () => {
    const result = await optimizeBatchPlan(
      request(['a', 'b'], 'minimum-cost', ['a']),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '甜味'),
          ],
          candidates: [
            recipe('sweet', ['檸檬', '糖'], ['甜味'], 19),
          ],
        },
      },
    )

    expect(result.formalSalesCount).toBe(1)
    expect(result.potentialTrialCount).toBe(1)
    expect(result.knownSalesRevenue).toBe(19)
    expect(result.totalIngredientCost).toBe(16)
    expect(result.knownGrossProfit).toBe(3)
  })

  it('lists customers without any reliable full match as unresolved', async () => {
    const result = await optimizeBatchPlan(
      request(['a', 'b']),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '不存在效果'),
          ],
          candidates: [
            recipe('sweet', ['檸檬', '糖'], ['甜味']),
          ],
        },
      },
    )

    expect(result.assignments).toEqual([
      { customerId: 'a', recipeId: 'sweet' },
    ])
    expect(result.unresolvedCustomers).toEqual(['b'])
  })

  it('excludes supplied customers from demand', async () => {
    const result = await optimizeBatchPlan(
      {
        ...request(['a', 'b']),
        suppliedCustomerIds: ['b'],
      },
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '甜味'),
          ],
          candidates: [
            recipe('sweet', ['檸檬', '糖'], ['甜味']),
          ],
        },
      },
    )

    expect(result.assignments.map((item) => item.customerId)).toEqual(['a'])
  })

  it('aggregates a shopping list from selected batch counts', async () => {
    const result = await optimizeBatchPlan(
      request(['a', 'b', 'c']),
      {
        source: {
          customers: [
            customer('a', '甜味'),
            customer('b', '甜味'),
            customer('c', '甜味'),
          ],
          candidates: [
            recipe('sweet', ['檸檬', '糖'], ['甜味']),
          ],
        },
      },
    )

    expect(result.shoppingList).toEqual(
      expect.arrayContaining([
        {
          ingredientId: 'lemon',
          name: '檸檬',
          quantity: 2,
          unitPrice: 9,
          totalCost: 18,
        },
        {
          ingredientId: 'sugar',
          name: '糖',
          quantity: 2,
          unitPrice: 7,
          totalCost: 14,
        },
      ]),
    )
    expect(
      result.shoppingList.reduce((sum, item) => sum + item.totalCost, 0),
    ).toBe(result.totalIngredientCost)
  })
  it('solves the current tranquil-fountain dataset without duplicate assignments', async () => {
    const result = await optimizeBatchPlan({
      customerIds: canonicalCustomers.map((item) => item.id),
      currentProgress: 'tranquil-fountain-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
      },
      formalCustomerIds: canonicalCustomers.map((item) => item.id),
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
    })

    const assignedIds = result.assignments.map((item) => item.customerId)
    expect(new Set(assignedIds).size).toBe(assignedIds.length)
    expect(
      assignedIds.length + result.unresolvedCustomers.length,
    ).toBe(canonicalCustomers.length)
    expect(result.batches.every((batch) => batch.customerIds.length <= 2)).toBe(true)
    expect(
      result.shoppingList.reduce((sum, item) => sum + item.totalCost, 0),
    ).toBe(result.totalIngredientCost)
  })
})
