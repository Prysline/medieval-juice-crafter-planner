import { describe, expect, it, vi } from 'vitest'
import type { RecipeCandidate } from '../types'
import { machineOperationBreakdownForSelection } from './optimizerCertificates'
import { highsSolverAdapter } from './optimizerHighsSolver'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationRequest,
} from './optimizerModel'

const ENV_KEY = 'OPTIMIZER_DEV_SINGLETON_SUBSTITUTION'

function request(ids: string[]): OptimizationRequest {
  return {
    customerIds: ids,
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 999,
    },
    formalCustomerIds: ids,
    candidatePolicy: 'observed-only',
    objective: 'minimum-waste',
    priorities: [
      'minimum-waste',
      'maximum-ingredient-cost',
      'minimum-machine-operations',
    ],
    availableJuiceJarCount: 2,
  }
}

function recipe(
  id: string,
  eligibleCustomerIds: string[],
): EligibleOptimizationRecipe {
  const candidate: RecipeCandidate = {
    id,
    name: id,
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: 10,
    ingredients: ['檸檬'],
    effects: [{ name: '甜味', value: 5 }],
    equipment: [],
  }
  return {
    candidate,
    eligibleCustomerIds,
    juiceUnitIngredientCost: 10,
    productionPath: {
      ingredientIds: ['common-juice'],
      edges: [
        {
          // Both recipes use the same edge, with q_upper=2.
          // It must keep an integer op; q=2 can fit in one batch.
          key: 'juice:common',
          kind: 'juicing',
          equipment: '柑橘榨汁機',
          fromIngredientIds: [],
          toIngredientIds: ['common-juice'],
        },
        {
          // Each finalizing edge has its own q_upper=1, so op=q.
          key: `finish:${id}`,
          kind: 'finalizing',
          equipment: '果汁成品台',
          fromIngredientIds: ['common-juice'],
          toIngredientIds: ['common-juice'],
        },
      ],
    },
  }
}

function domain(
  ids: string[],
  groups: [string, string[]][],
): BatchOptimizationModel {
  return {
    request: request(ids),
    serviceableCustomerIds: ids,
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes: groups.map(([id, group]) => recipe(id, group)),
  }
}

type BuiltEvent = {
  step?: string
  objective?: string
  operationVariables?: number
  substitutedOperationExpressions?: number
  groupedAssignments?: number
}

async function runCase(
  fixture: BatchOptimizationModel,
  enabled: boolean,
) {
  const prior = process.env[ENV_KEY]
  if (enabled) process.env[ENV_KEY] = '1'
  else delete process.env[ENV_KEY]

  const logger = vi.spyOn(console, 'info').mockImplementation(() => {})
  try {
    const result = await highsSolverAdapter.solve(
      fixture,
      fixture.request.priorities!,
    )
    const machineStages = logger.mock.calls.flatMap(([tag, details]) => {
      const event = details as BuiltEvent | undefined
      return tag === '[optimizer-dev-stage]' &&
        event?.step === 'generic-model-built' &&
        event.objective === 'machineOperations'
        ? [event]
        : []
    })
    return { result, machineStages }
  } finally {
    logger.mockRestore()
    if (prior === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = prior
  }
}

describe('dev-only exact singleton operation substitution', () => {
  it('replaces only q_upper<=1 edges and preserves the generic shared op, lex results and physical count', async () => {
    const fixture = domain(
      ['a', 'b', 'c', 'd'],
      [
        ['ab', ['a', 'b']],
        ['cd', ['c', 'd']],
      ],
    )

    const baseline = await runCase(fixture, false)
    const substituted = await runCase(fixture, true)

    expect(baseline.machineStages).toContainEqual(
      expect.objectContaining({
        operationVariables: 3,
        substitutedOperationExpressions: 0,
      }),
    )
    expect(substituted.machineStages).toContainEqual(
      expect.objectContaining({
        operationVariables: 1,
        substitutedOperationExpressions: 2,
        groupedAssignments: 1,
      }),
    )
    expect(substituted.result).toEqual(baseline.result)
    expect(substituted.result.productionUnitsByRecipeId).toEqual({
      ab: 1,
      cd: 1,
    })
    expect(substituted.result.metrics.machineOperations).toBe(3)
    expect(
      machineOperationBreakdownForSelection(
        fixture,
        Object.entries(substituted.result.productionUnitsByRecipeId).map(
          ([recipeId, units]) => ({ recipeId, units }),
        ),
      ).total,
    ).toBe(3)
  })

  it('keeps a repeated q_upper=2 operation edge integer while replacing only the q_upper=1 edge', async () => {
    const fixture = domain(
      ['a', 'b'],
      [['ab', ['a', 'b']]],
    )
    const first = fixture.recipes[0].productionPath.edges[0]
    fixture.recipes[0].productionPath.edges.splice(1, 0, {
      ...first,
    })

    const baseline = await runCase(fixture, false)
    const substituted = await runCase(fixture, true)

    expect(baseline.machineStages).toContainEqual(
      expect.objectContaining({
        operationVariables: 2,
        substitutedOperationExpressions: 0,
      }),
    )
    expect(substituted.machineStages).toContainEqual(
      expect.objectContaining({
        operationVariables: 1,
        substitutedOperationExpressions: 1,
      }),
    )
    expect(substituted.result).toEqual(baseline.result)
    expect(substituted.result.metrics.machineOperations).toBe(2)
    expect(
      machineOperationBreakdownForSelection(
        fixture,
        Object.entries(substituted.result.productionUnitsByRecipeId).map(
          ([recipeId, units]) => ({ recipeId, units }),
        ),
      ).total,
    ).toBe(2)
  })

  it('does not change the machine stage when the customer count has nonzero pair slack', async () => {
    const fixture = domain(
      ['a', 'b', 'c'],
      [
        ['ab', ['a', 'b']],
        ['c', ['c']],
      ],
    )
    const baseline = await runCase(fixture, false)
    const requested = await runCase(fixture, true)
    expect(requested.result).toEqual(baseline.result)
    expect(requested.machineStages).toContainEqual(
      expect.objectContaining({
        substitutedOperationExpressions: 0,
      }),
    )
  })

  it('preserves generic exact fallback when jar-fill hard constraints prevent grouping', async () => {
    const fixture = domain(
      ['a', 'b', 'c', 'd'],
      [
        ['ab', ['a', 'b']],
        ['cd', ['c', 'd']],
      ],
    )
    fixture.request.constraints = { maxJarFillOperations: 2 }

    const baseline = await runCase(fixture, false)
    const requested = await runCase(fixture, true)
    expect(requested.result).toEqual(baseline.result)
    expect(requested.machineStages).toContainEqual(
      expect.objectContaining({
        substitutedOperationExpressions: 0,
      }),
    )
    expect(requested.result.metrics.machineOperations).toBe(3)
  })
})
