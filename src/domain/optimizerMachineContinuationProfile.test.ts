import { Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import {
  machineOperationBreakdownForSelection,
  repairMachineOperationWitness,
  type RecipeUnitSelection,
} from './optimizerCertificates'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'

const PRODUCTION_UNITS_FIX = 35
const ASSIGNED_INGREDIENT_COST_FIX = 3853
const PRODUCTION_COST_FIX = 1948
const SERVICEABLE_CUSTOMER_COUNT = 69
const GLOBAL_SERVING_SLACK =
  PRODUCTION_UNITS_FIX * 2 - SERVICEABLE_CUSTOMER_COUNT
const SINGLETON_RECIPE_COST =
  PRODUCTION_COST_FIX * 2 - ASSIGNED_INGREDIENT_COST_FIX
const CERTIFIED_RELAXED_MACHINE_LOWER_BOUND = 56

function canonicalDomain(): BatchOptimizationModel {
  const currentProgress = 'liquid-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)

  const request: OptimizationRequest = {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }

  return buildOptimizationModel(request, {
    customers: canonicalCustomers,
    candidatePool: buildRecipeCandidatePool(currentProgress),
  })
}

interface PairParityGroup {
  key: string
  recipes: EligibleOptimizationRecipe[]
  eligibleCustomerIds: string[]
  ingredientCost: number
}

function pairParityGroups(
  domain: BatchOptimizationModel,
): PairParityGroup[] {
  const groups = new Map<string, PairParityGroup>()

  for (const recipe of domain.recipes) {
    const eligibleCustomerIds = [
      ...recipe.eligibleCustomerIds,
    ].sort()
    const ingredientCost = recipe.juiceUnitIngredientCost
    const key =
      `${eligibleCustomerIds.join('\u001e')}\u001d${ingredientCost}`
    const current = groups.get(key)
    if (current) current.recipes.push(recipe)
    else {
      groups.set(key, {
        key,
        recipes: [recipe],
        eligibleCustomerIds,
        ingredientCost,
      })
    }
  }

  return [...groups.values()]
}

async function solvePairParityGroupUnits(
  domain: BatchOptimizationModel,
): Promise<Map<string, number>> {
  if (GLOBAL_SERVING_SLACK !== 1) {
    throw new Error('Profiler expects exactly one global slack serving')
  }

  const groups = pairParityGroups(domain)
  const model = new Model()
  const coverageTermsByCustomerId = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    domain.serviceableCustomerIds.map((customerId) => [
      customerId,
      [],
    ]),
  )
  const unitVarsByGroupKey = new Map<
    string,
    ReturnType<Model['boolVar']>[]
  >(
    groups.map((group) => [group.key, []]),
  )
  const assignedCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const productionCostTerms: ReturnType<
    ReturnType<Model['boolVar']>['times']
  >[] = []
  const singletonVars: ReturnType<Model['boolVar']>[] = []
  const allUnitVars: ReturnType<Model['boolVar']>[] = []

  const addCoverage = (
    customerId: string,
    variable: ReturnType<Model['boolVar']>,
  ) => {
    const terms = coverageTermsByCustomerId.get(customerId)
    if (!terms) {
      throw new Error(`Unknown customer ${customerId}`)
    }
    terms.push(variable)
  }

  groups.forEach((group, groupIndex) => {
    group.eligibleCustomerIds.forEach(
      (customerId, customerIndex) => {
        const singleton = model.boolVar(
          `single_${groupIndex}_${customerIndex}`,
        )
        singletonVars.push(singleton)
        allUnitVars.push(singleton)
        unitVarsByGroupKey.get(group.key)!.push(singleton)
        addCoverage(customerId, singleton)
        assignedCostTerms.push(
          singleton.times(group.ingredientCost),
        )
        productionCostTerms.push(
          singleton.times(group.ingredientCost),
        )
      },
    )

    for (
      let leftIndex = 0;
      leftIndex < group.eligibleCustomerIds.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < group.eligibleCustomerIds.length;
        rightIndex += 1
      ) {
        const pair = model.boolVar(
          `pair_${groupIndex}_${leftIndex}_${rightIndex}`,
        )
        allUnitVars.push(pair)
        unitVarsByGroupKey.get(group.key)!.push(pair)
        addCoverage(group.eligibleCustomerIds[leftIndex], pair)
        addCoverage(group.eligibleCustomerIds[rightIndex], pair)
        assignedCostTerms.push(
          pair.times(group.ingredientCost * 2),
        )
        productionCostTerms.push(
          pair.times(group.ingredientCost),
        )
      }
    }
  })

  domain.serviceableCustomerIds.forEach(
    (customerId, customerIndex) => {
      model.addConstraint(
        sum(...(coverageTermsByCustomerId.get(customerId) ?? []))
          .eq(1),
        `cover_${customerIndex}`,
      )
    },
  )
  model.addConstraint(
    sum(...singletonVars).eq(1),
    'singleton_total',
  )
  model.addConstraint(
    sum(...allUnitVars).eq(PRODUCTION_UNITS_FIX),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(ASSIGNED_INGREDIENT_COST_FIX),
    'assigned_cost_fix',
  )
  model.minimize(sum(...productionCostTerms))

  const solution = await model.solve()
  if (solution.status !== 'optimal') {
    throw new Error(
      `Pair parity witness stage ended with ${solution.status}`,
    )
  }
  expect(Math.round(solution.objective)).toBe(PRODUCTION_COST_FIX)

  return new Map(
    groups.map((group) => [
      group.key,
      (unitVarsByGroupKey.get(group.key) ?? []).reduce(
        (total, variable) =>
          total + (solution.getValue(variable) > 0.5 ? 1 : 0),
        0,
      ),
    ]),
  )
}

function greedyRecipeWitness(
  domain: BatchOptimizationModel,
  unitsByGroupKey: Map<string, number>,
): RecipeUnitSelection[] {
  const selected: RecipeUnitSelection[] = []
  const groups = pairParityGroups(domain)
    .filter((group) => (unitsByGroupKey.get(group.key) ?? 0) > 0)
    .sort(
      (left, right) =>
        (unitsByGroupKey.get(right.key) ?? 0) -
          (unitsByGroupKey.get(left.key) ?? 0) ||
        left.key.localeCompare(right.key),
    )

  for (const group of groups) {
    const units = unitsByGroupKey.get(group.key) ?? 0
    let bestRecipeId: string | null = null
    let bestTotal = Number.POSITIVE_INFINITY

    for (const recipe of group.recipes) {
      const candidate = [
        ...selected,
        { recipeId: recipe.candidate.id, units },
      ]
      const total =
        machineOperationBreakdownForSelection(
          domain,
          candidate,
        ).total
      if (
        total < bestTotal ||
        (
          total === bestTotal &&
          (
            bestRecipeId === null ||
            recipe.candidate.id.localeCompare(bestRecipeId) < 0
          )
        )
      ) {
        bestTotal = total
        bestRecipeId = recipe.candidate.id
      }
    }

    if (!bestRecipeId) {
      throw new Error(`No witness recipe for group ${group.key}`)
    }
    selected.push({ recipeId: bestRecipeId, units })
  }

  return selected
}

it(
  'lifts exact pair parity to a real-recipe machine witness',
  async () => {
    const domain = canonicalDomain()

    expect(domain.recipes).toHaveLength(7892)
    expect(domain.serviceableCustomerIds).toHaveLength(
      SERVICEABLE_CUSTOMER_COUNT,
    )
    expect(GLOBAL_SERVING_SLACK).toBe(1)
    expect(SINGLETON_RECIPE_COST).toBe(43)

    const pairStartedAt = performance.now()
    const unitsByGroupKey =
      await solvePairParityGroupUnits(domain)
    const pairSolveMs = performance.now() - pairStartedAt

    const initialWitness = greedyRecipeWitness(
      domain,
      unitsByGroupKey,
    )
    const initialBreakdown =
      machineOperationBreakdownForSelection(
        domain,
        initialWitness,
      )

    const repairStartedAt = performance.now()
    const repaired = repairMachineOperationWitness(
      domain,
      initialWitness,
      PRODUCTION_COST_FIX,
      CERTIFIED_RELAXED_MACHINE_LOWER_BOUND,
      100,
    )
    const repairMs = performance.now() - repairStartedAt

    const totalUnits = repaired.selections.reduce(
      (total, selection) => total + selection.units,
      0,
    )
    const totalCost = repaired.selections.reduce(
      (total, selection) => {
        const recipe = domain.recipes.find(
          (entry) => entry.candidate.id === selection.recipeId,
        )
        return (
          total +
          selection.units *
            (recipe?.juiceUnitIngredientCost ?? 0)
        )
      },
      0,
    )

    console.info(
      '[machine-real-recipe-witness]',
      JSON.stringify({
        pairSolveMs: Math.round(pairSolveMs),
        selectedGroupCount: [...unitsByGroupKey.values()]
          .filter((units) => units > 0).length,
        initialRecipeCount: initialWitness.length,
        initialBreakdown,
        repairedRecipeCount: repaired.selections.length,
        repairedBreakdown: repaired.breakdown,
        repairSteps: repaired.steps.length,
        repairMs: Math.round(repairMs),
        certifiedRelaxedLowerBound:
          CERTIFIED_RELAXED_MACHINE_LOWER_BOUND,
        totalUnits,
        totalCost,
      }),
    )

    expect(totalUnits).toBe(PRODUCTION_UNITS_FIX)
    expect(totalCost).toBe(PRODUCTION_COST_FIX)
    expect(repaired.breakdown.total).toBeLessThanOrEqual(
      initialBreakdown.total,
    )
  },
  120000,
)
