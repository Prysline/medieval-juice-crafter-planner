import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
import type { RecipeCandidatePool } from './recipeCandidatePool'
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

  it('continues progressive search past an unknown-price computed match for a formal revenue objective', () => {
    const computed = candidate(
      'computed-shallow',
      'computed',
      ['檸檬', '糖'],
      [{ name: '甜味', value: 5 }],
    )
    const observed = candidate(
      'observed-deeper',
      'observed',
      ['橙子', '糖', '薄荷'],
      [{ name: '甜味', value: 5 }],
    )
    const pool: RecipeCandidatePool = {
      entries: [
        {
          id: computed.id,
          ingredientIds: ['lemon', 'sugar'],
          candidate: computed,
          sources: ['computed'],
          savedRecipeIds: [],
          availableAtCurrentProgress: true,
          inGeneratedSearchScope: true,
        },
        {
          id: observed.id,
          ingredientIds: ['orange', 'sugar', 'mint'],
          candidate: observed,
          sources: ['observed'],
          savedRecipeIds: [],
          availableAtCurrentProgress: true,
          inGeneratedSearchScope: true,
        },
      ],
      generatedLayers: [
        {
          phase: 'unique',
          seasoningDepth: 1,
          segmentCount: 1,
          ingredientCount: 2,
          candidateIds: [computed.id],
          totalSequenceCount: 1,
          truncated: false,
        },
        {
          phase: 'unique',
          seasoningDepth: 2,
          segmentCount: 1,
          ingredientCount: 3,
          candidateIds: [observed.id],
          totalSequenceCount: 1,
          truncated: false,
        },
      ],
      rejectedSavedRecipes: [],
    }

    const model = buildOptimizationModel(
      {
        ...baseRequest,
        customerIds: ['a'],
        formalCustomerIds: ['a'],
        candidatePolicy: 'allow-unambiguous-computed',
        objective: 'maximum-known-revenue',
      },
      {
        customers,
        candidatePool: pool,
      },
    )

    expect(model.serviceableCustomerIds).toEqual(['a'])
    expect(
      model.recipes.map((recipe) => recipe.candidate.id),
    ).toEqual(['observed-deeper'])
  })

  it('keeps deeper legal full matches in the optimizer matrix for comparison objectives', () => {
    const shallow = {
      ...candidate(
        'observed-shallow',
        'observed',
        ['橙子', '肉桂'],
        [{ name: '甜味', value: 5 }],
      ),
      salePrice: 30,
    }
    const deeper = {
      ...candidate(
        'observed-deeper-comparable',
        'observed',
        ['檸檬', '糖'],
        [{ name: '甜味', value: 5 }],
      ),
      salePrice: 40,
    }
    const pool: RecipeCandidatePool = {
      entries: [
        {
          id: shallow.id,
          ingredientIds: ['orange', 'cinnamon'],
          candidate: shallow,
          sources: ['observed'],
          savedRecipeIds: [],
          availableAtCurrentProgress: true,
          inGeneratedSearchScope: true,
        },
        {
          id: deeper.id,
          ingredientIds: ['lemon', 'sugar'],
          candidate: deeper,
          sources: ['observed'],
          savedRecipeIds: [],
          availableAtCurrentProgress: true,
          inGeneratedSearchScope: true,
        },
      ],
      generatedLayers: [
        {
          phase: 'unique',
          seasoningDepth: 0,
          segmentCount: 1,
          ingredientCount: 1,
          candidateIds: [shallow.id],
          totalSequenceCount: 1,
          truncated: false,
        },
        {
          phase: 'unique',
          seasoningDepth: 1,
          segmentCount: 1,
          ingredientCount: 2,
          candidateIds: [deeper.id],
          totalSequenceCount: 1,
          truncated: false,
        },
      ],
      rejectedSavedRecipes: [],
    }

    for (const objective of [
      'minimum-cost',
      'maximum-known-revenue',
      'maximum-known-gross-profit',
    ] as const) {
      const model = buildOptimizationModel(
        {
          ...baseRequest,
          customerIds: ['a'],
          formalCustomerIds: ['a'],
          candidatePolicy: 'observed-only',
          objective,
        },
        {
          customers,
          candidatePool: pool,
        },
      )

      expect(model.serviceableCustomerIds).toEqual(['a'])
      expect(model.recipes.map((recipe) => recipe.candidate.id)).toEqual([
        shallow.id,
        deeper.id,
      ])
    }
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
  it('excludes repeated-ingredient candidates when maximum ingredient cost is a priority', () => {
    const repeated = {
      id: 'repeat-expensive',
      name: '重複高成本',
      ingredients: ['檸檬', '糖', '糖'],
      effects: [],
      source: 'computed' as const,
      salePrice: null,
      unlockedAt: 'seasoner-unlocked' as const,
    }
    const unique = {
      id: 'unique-expensive',
      name: '不重複高成本',
      ingredients: ['檸檬', '糖'],
      effects: [],
      source: 'computed' as const,
      salePrice: null,
      unlockedAt: 'seasoner-unlocked' as const,
    }
    const source = {
      customers: [{
        id: 'test-customer',
        name: '測試顧客',
        village: 'town' as const,
        unlockedAt: 'seasoner-unlocked' as const,
        preferences: [],
      }],
      candidates: [repeated, unique],
    }
    const request = {
      customerIds: ['test-customer'],
      currentProgress: 'seasoner-unlocked' as const,
      suppliedCustomerIds: [],
      satisfactionByVillage: {},
      formalCustomerIds: [],
      candidatePolicy: 'allow-unambiguous-computed' as const,
      objective: 'maximum-ingredient-cost' as const,
      priorities: ['maximum-ingredient-cost' as const],
      availableJuiceJarCount: 1,
    }
    const model = buildOptimizationModel(request, source)
    expect(model.recipes.map((recipe) => recipe.candidate.id)).not.toContain(
      'repeat-expensive',
    )
  })

})
