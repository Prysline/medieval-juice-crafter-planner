import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'

const customers: Customer[] = [
  {
    id: 'a',
    name: 'A',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: '甜味' }],
  },
  {
    id: 'b',
    name: 'B',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: '清新口氣' }],
  },
]

function candidate(
  id: string,
  source: RecipeCandidate['source'],
  ingredients: string[],
  effects: RecipeCandidate['effects'],
  unlockedAt: RecipeCandidate['unlockedAt'] = 'seasoner-unlocked',
): RecipeCandidate {
  return {
    id,
    name: id,
    source,
    unlockedAt,
    salePrice: source === 'observed' ? 10 : null,
    ingredients,
    effects,
    equipment: [],
  }
}

const baseRequest: OptimizationRequest = {
  customerIds: ['a', 'b'],
  suppliedCustomerIds: [],
  satisfactionByVillage: {
    'east-harbor': 0,
    'tranquil-fountain': 0,
  },
  formalCustomerIds: ['a', 'b'],
  currentProgress: 'seasoner-unlocked',
  candidatePolicy: 'allow-unambiguous-computed',
  objective: 'minimum-cost',
}

describe('optimizer model', () => {
  it('requires every customer preference to match before a recipe becomes eligible', () => {
    const multiPreferenceCustomer: Customer = {
      id: 'multi',
      name: 'Multi',
      occupation: '測試',
      villageId: 'east-harbor',
      satisfactionRequired: 0,
      preferences: [
        { kind: 'ingredient', value: '檸檬' },
        { kind: 'effect', value: '甜味' },
      ],
    }

    const model = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['multi'],
        formalCustomerIds: ['multi'],
      },
      {
        customers: [multiPreferenceCustomer],
        candidates: [
          candidate(
            'partial-only',
            'observed',
            ['檸檬'],
            [{ name: '酸味', value: 5 }],
          ),
          candidate(
            'full-match',
            'observed',
            ['檸檬', '糖'],
            [{ name: '甜味', value: 5 }],
          ),
        ],
      },
    )

    expect(model.serviceableCustomerIds).toEqual(['multi'])
    expect(model.recipes.map((recipe) => recipe.candidate.id)).toEqual([
      'full-match',
    ])
    expect(model.recipes[0].eligibleCustomerIds).toEqual(['multi'])
  })

  it('builds a customer-to-eligible-recipe matrix and excludes supplied demand', () => {
    const model = buildOptimizationModel(
      {
        ...baseRequest,
        suppliedCustomerIds: ['b'],
      },
      {
        customers,
        candidates: [
          candidate(
            'sweet',
            'observed',
            ['檸檬', '糖'],
            [{ name: '甜味', value: 5 }],
          ),
          candidate(
            'fresh',
            'observed',
            ['檸檬', '薄荷'],
            [{ name: '清新口氣', value: 4 }],
          ),
        ],
      },
    )

    expect(model.serviceableCustomerIds).toEqual(['a'])
    expect(model.excludedSuppliedCustomerIds).toEqual(['b'])
    expect(model.unresolvedCustomerIds).toEqual([])
    expect(model.recipes.map((recipe) => recipe.candidate.id)).toEqual([
      'sweet',
    ])
  })

  it('reports unknown, locked, future-region, and no-full-match customers as unresolved', () => {
    const locked: Customer = {
      id: 'locked',
      name: 'Locked',
      occupation: '測試',
      villageId: 'east-harbor',
      satisfactionRequired: 100,
      preferences: [{ kind: 'effect', value: '甜味' }],
    }
    const future: Customer = {
      id: 'future',
      name: 'Future',
      occupation: '測試',
      villageId: 'tranquil-fountain',
      satisfactionRequired: 0,
      preferences: [{ kind: 'effect', value: '甜味' }],
    }

    const model = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['missing', 'locked', 'future', 'b'],
      },
      {
        customers: [...customers, locked, future],
        candidates: [
          candidate(
            'sweet',
            'observed',
            ['檸檬', '糖'],
            [{ name: '甜味', value: 5 }],
          ),
        ],
      },
    )

    expect(model.serviceableCustomerIds).toEqual([])
    expect(model.unresolvedCustomerIds).toEqual([
      'missing',
      'locked',
      'future',
      'b',
    ])
  })

  it('keeps observed-only separate from computed and rejects ambiguous candidates', () => {
    const computed = candidate(
      'computed',
      'computed',
      ['檸檬', '糖'],
      [{ name: '甜味', value: 5 }],
    )
    const ambiguous = candidate(
      'ambiguous',
      'computed',
      ['橙子', '糖'],
      [{ name: '甜味', value: 5 }],
    )
    ambiguous.effectAmbiguity = {
      cutoffValue: 3,
      remainingSlots: 1,
      candidates: [
        { name: '補充精力', value: 3 },
        { name: '芳香', value: 3 },
      ],
    }

    const observedOnly = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
        candidatePolicy: 'observed-only',
      },
      {
        customers,
        candidates: [computed, ambiguous],
      },
    )

    expect(observedOnly.serviceableCustomerIds).toEqual([])
    expect(observedOnly.unresolvedCustomerIds).toEqual(['a'])

    const allowComputed = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
      },
      {
        customers,
        candidates: [computed, ambiguous],
      },
    )

    expect(allowComputed.serviceableCustomerIds).toEqual(['a'])
    expect(allowComputed.recipes.map((recipe) => recipe.candidate.id)).toEqual([
      'computed',
    ])
  })

  it('requires known sale price for formal customers only in revenue objectives', () => {
    const unknownPrice = candidate(
      'computed',
      'computed',
      ['檸檬', '糖'],
      [{ name: '甜味', value: 5 }],
    )

    const formalRevenue = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
        formalCustomerIds: ['a'],
        objective: 'maximum-known-revenue',
      },
      {
        customers,
        candidates: [unknownPrice],
      },
    )

    expect(formalRevenue.serviceableCustomerIds).toEqual([])
    expect(formalRevenue.unresolvedCustomerIds).toEqual(['a'])

    const potentialRevenue = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
        formalCustomerIds: [],
        objective: 'maximum-known-revenue',
      },
      {
        customers,
        candidates: [unknownPrice],
      },
    )

    expect(potentialRevenue.serviceableCustomerIds).toEqual(['a'])
    expect(potentialRevenue.recipes.map((recipe) => recipe.candidate.id)).toEqual([
      'computed',
    ])
  })

  it('keeps future-progress candidates out of the eligible matrix', () => {
    const model = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
        currentProgress: 'juicer-unlocked',
      },
      {
        customers,
        candidates: [
          candidate(
            'future',
            'computed',
            ['香蕉', '肉桂'],
            [{ name: '甜味', value: 5 }],
            'tranquil-fountain-unlocked',
          ),
        ],
      },
    )

    expect(model.serviceableCustomerIds).toEqual([])
    expect(model.unresolvedCustomerIds).toEqual(['a'])
  })

  it('admits a confirmed multi-base Blender path after its unlock', () => {
    const blenderCandidate = candidate(
      'blend',
      'computed',
      ['檸檬', '糖', '橙子', '薄荷'],
      [{ name: '甜味', value: 5 }],
      'juice-blender-unlocked',
    )

    const model = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
        formalCustomerIds: [],
        currentProgress: 'juice-blender-unlocked',
      },
      {
        customers,
        candidates: [blenderCandidate],
      },
    )

    expect(model.serviceableCustomerIds).toEqual(['a'])
    expect(model.recipes).toHaveLength(1)
    expect(
      model.recipes[0].productionPath.edges.map((edge) => edge.kind),
    ).toContain('blending')
  })
})
