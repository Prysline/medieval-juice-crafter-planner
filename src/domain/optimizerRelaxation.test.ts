import { describe, expect, it } from 'vitest'
import type { Customer, RecipeCandidate } from '../types'
import {
  buildOptimizationModel,
  normalizedOptimizationPriorities,
  type OptimizationCriterion,
  type OptimizationRequest,
  type OptimizationSource,
} from './optimizerModel'
import { profileHighsOptimization } from './optimizerHighsSolver'

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
  salePrice: number | null,
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
  objective: OptimizationRequest['objective'],
  priorities: OptimizationCriterion[],
): OptimizationRequest {
  return {
    customerIds,
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'observed-only',
    objective,
    priorities,
    availableJuiceJarCount: 2,
  }
}

const sharedSource: OptimizationSource = {
  customers: [
    customer('a', 'A'),
    customer('b', 'B'),
    customer('c', 'C'),
    customer('d', 'A'),
  ],
  candidates: [
    recipe('a-cheap', ['檸檬'], ['A'], 12),
    recipe('b-cheap', ['橙子'], ['B'], 16),
    recipe('c-cheap', ['檸檬', '糖'], ['C'], 22),
    recipe('ab-rich', ['檸檬', '糖', '薄荷'], ['A', 'B'], 52),
    recipe('ac-rich', ['橙子', '糖', '薄荷'], ['A', 'C'], 48),
    recipe(
      'abc-shared',
      ['檸檬', '糖', '薄荷'],
      ['A', 'B', 'C'],
      40,
    ),
  ],
}

async function expectRelaxationEquivalent(
  optimizationRequest: OptimizationRequest,
  source: OptimizationSource,
) {
  const model = buildOptimizationModel(
    optimizationRequest,
    source,
  )
  const priorities = normalizedOptimizationPriorities(
    optimizationRequest,
  )

  const binary = await profileHighsOptimization(
    model,
    priorities,
    { stageTimeLimitSeconds: 5.5 },
  )
  const relaxed = await profileHighsOptimization(
    model,
    priorities,
    {
      stageTimeLimitSeconds: 5.5,
      relaxAssignmentVariables: true,
    },
  )

  expect(binary.terminatedAtObjective).toBeNull()
  expect(relaxed.terminatedAtObjective).toBeNull()
  expect(binary.stages).toHaveLength(relaxed.stages.length)

  for (let index = 0; index < binary.stages.length; index += 1) {
    const binaryStage = binary.stages[index]
    const relaxedStage = relaxed.stages[index]

    expect(relaxedStage.objective).toBe(binaryStage.objective)
    expect(binaryStage.status).toBe('optimal')
    expect(relaxedStage.status).toBe('optimal')
    expect(relaxedStage.objectiveValue).toBeCloseTo(
      binaryStage.objectiveValue ?? 0,
      9,
    )
    expect(relaxedStage.fractionalAssignmentVariableCount).toBe(0)
    expect(relaxedStage.maxAssignmentIntegralityError).toBe(0)
    expect(
      relaxedStage.integralAssignmentReconstructionFeasible,
    ).toBe(true)
    expect(relaxedStage.reconstructedAssignmentCount).toBe(
      model.serviceableCustomerIds.length,
    )
  }
}

describe('relaxed customer-assignment correctness matrix', () => {
  const criterionCases: Array<{
    name: string
    objective: OptimizationRequest['objective']
    priorities: OptimizationCriterion[]
  }> = [
    {
      name: 'minimum-cost',
      objective: 'minimum-cost',
      priorities: ['minimum-cost'],
    },
    {
      name: 'minimum-waste',
      objective: 'minimum-waste',
      priorities: ['minimum-waste'],
    },
    {
      name: 'maximum-ingredient-cost',
      objective: 'maximum-ingredient-cost',
      priorities: ['maximum-ingredient-cost'],
    },
    {
      name: 'maximum-known-revenue',
      objective: 'maximum-known-revenue',
      priorities: ['maximum-known-revenue'],
    },
    {
      name: 'maximum-known-gross-profit',
      objective: 'maximum-known-gross-profit',
      priorities: ['maximum-known-gross-profit'],
    },
    {
      name: 'minimum-machine-operations',
      objective: 'minimum-cost',
      priorities: ['minimum-machine-operations'],
    },
    {
      name: 'minimum-jar-switches',
      objective: 'minimum-cost',
      priorities: ['minimum-jar-switches'],
    },
  ]

  for (const criterionCase of criterionCases) {
    it(`matches binary assignments for ${criterionCase.name}`, async () => {
      await expectRelaxationEquivalent(
        request(
          ['a', 'b', 'c', 'd'],
          criterionCase.objective,
          criterionCase.priorities,
        ),
        sharedSource,
      )
    })
  }

  it('matches with a prefilled jar that must be consumed before reuse', async () => {
    const source: OptimizationSource = {
      customers: [
        customer('a', 'A'),
        customer('b', 'B'),
      ],
      candidates: [
        recipe('a-only', ['檸檬'], ['A'], 12),
        recipe('b-only', ['橙子'], ['B'], 16),
        recipe(
          'shared',
          ['檸檬', '糖', '薄荷'],
          ['A', 'B'],
          40,
        ),
      ],
    }

    await expectRelaxationEquivalent(
      {
        ...request(
          ['a', 'b'],
          'minimum-cost',
          ['minimum-cost', 'minimum-jar-switches'],
        ),
        initialAvailableJuiceJars: [
          { recipeId: 'a-only', servings: 1 },
        ],
        availableJuiceJarCount: undefined,
      },
      source,
    )
  })

  it('matches with a hard maximum jar-switch constraint', async () => {
    const source: OptimizationSource = {
      customers: [
        customer('a', 'A'),
        customer('b', 'B'),
      ],
      candidates: [
        recipe('a-only', ['檸檬'], ['A'], 12),
        recipe('b-only', ['橙子'], ['B'], 16),
        recipe(
          'shared',
          ['檸檬', '糖', '薄荷'],
          ['A', 'B'],
          40,
        ),
      ],
    }

    await expectRelaxationEquivalent(
      {
        ...request(
          ['a', 'b'],
          'minimum-cost',
          ['minimum-cost', 'minimum-jar-switches'],
        ),
        availableJuiceJarCount: 1,
        constraints: {
          maxJarTypeSwitches: 0,
        },
      },
      source,
    )
  })

  it('matches across a multi-stage lexicographic priority chain', async () => {
    await expectRelaxationEquivalent(
      request(
        ['a', 'b', 'c', 'd'],
        'minimum-cost',
        [
          'minimum-cost',
          'minimum-machine-operations',
          'minimum-jar-switches',
          'minimum-waste',
        ],
      ),
      sharedSource,
    )
  })
})
