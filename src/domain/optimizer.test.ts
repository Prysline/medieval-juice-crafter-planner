import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
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
): RecipeCandidate {
  return {
    id,
    name: id,
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: 10,
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
): OptimizationRequest {
  return {
    customerIds,
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    candidatePolicy: 'observed-only',
    objective,
  }
}

describe('batch optimizer', () => {
  it('serves two customers sharing one recipe with one batch', () => {
    const result = optimizeBatchPlan(
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
    expect(result.assignedServings).toBe(2)
    expect(result.producedServings).toBe(2)
    expect(result.leftoverServings).toBe(0)
  })

  it('chooses a shared batch when per-customer cheapest recipes cost more in total', () => {
    const result = optimizeBatchPlan(
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

  it('reports one leftover serving for an odd number of assigned customers', () => {
    const result = optimizeBatchPlan(
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

  it('minimum-cost and minimum-waste can choose different valid plans', () => {
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

    const cheapest = optimizeBatchPlan(
      request(['a', 'b', 'c'], 'minimum-cost'),
      { source: { customers, candidates } },
    )
    const leastWaste = optimizeBatchPlan(
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

  it('lists customers without any reliable full match as unresolved', () => {
    const result = optimizeBatchPlan(
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

  it('excludes supplied customers from demand', () => {
    const result = optimizeBatchPlan(
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

  it('aggregates a shopping list from selected batch counts', () => {
    const result = optimizeBatchPlan(
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
})
