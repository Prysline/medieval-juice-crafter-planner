import { HiGHS, Model, sum } from '@bubblyworld/highs-ts'
import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import { finalizingEdgesAreRecipeIdentityUnique } from './optimizerCertificates'
import type { ProductionStepKind } from './productionPlan'

function assignmentKey(recipe: EligibleOptimizationRecipe): string {
  return `${[...recipe.eligibleCustomerIds].sort().join('\\u001e')}\\u001d${recipe.juiceUnitIngredientCost}`
}

function edgeMultiplicity(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): Map<string, number> {
  const multiplicity = new Map<string, number>()
  for (const edge of recipe.productionPath.edges) {
    if (!kinds.has(edge.kind)) continue
    multiplicity.set(
      edge.key,
      (multiplicity.get(edge.key) ?? 0) + 1,
    )
  }
  return multiplicity
}

function edgeSignature(
  recipe: EligibleOptimizationRecipe,
  kinds: ReadonlySet<ProductionStepKind>,
): string {
  return [...edgeMultiplicity(recipe, kinds).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}*${count}`)
    .join('\\u001f')
}

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

function buildPartitionQuotient(
  domain: BatchOptimizationModel,
  kinds: ReadonlySet<ProductionStepKind>,
  collapseFinalizingIdentity = false,
) {
  const assignmentGroups = new Map<
    string,
    {
      key: string
      eligibleCustomerIds: string[]
      ingredientCost: number
    }
  >()
  const machineGroups = new Map<
    string,
    {
      assignmentKey: string
      eligibleCustomerIds: string[]
      ingredientCost: number
      edgeMultiplicity: Map<string, number>
    }
  >()

  for (const recipe of domain.recipes) {
    const aKey = assignmentKey(recipe)
    if (!assignmentGroups.has(aKey)) {
      assignmentGroups.set(aKey, {
        key: aKey,
        eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
        ingredientCost: recipe.juiceUnitIngredientCost,
      })
    }
    const signature = collapseFinalizingIdentity
      ? '__finalizing_identity_relaxation__'
      : edgeSignature(recipe, kinds)
    const mKey = `${aKey}\\u001c${signature}`
    if (!machineGroups.has(mKey)) {
      machineGroups.set(mKey, {
        assignmentKey: aKey,
        eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
        ingredientCost: recipe.juiceUnitIngredientCost,
        edgeMultiplicity: collapseFinalizingIdentity
          ? new Map()
          : edgeMultiplicity(recipe, kinds),
      })
    }
  }

  const model = new Model()
  const assignmentsByGroup = new Map<string, ReturnType<Model['numVar']>[]>()
  const assignedCostTerms: ReturnType<ReturnType<Model['numVar']>['times']>[] = []

  domain.serviceableCustomerIds.forEach((customerId, customerIndex) => {
    const customerTerms: ReturnType<Model['numVar']>[] = []
    ;[...assignmentGroups.values()].forEach((group, groupIndex) => {
      if (!group.eligibleCustomerIds.includes(customerId)) return
      const y = model.numVar(0, 1, `y_${customerIndex}_${groupIndex}`)
      customerTerms.push(y)
      const groupTerms = assignmentsByGroup.get(group.key)
      if (groupTerms) groupTerms.push(y)
      else assignmentsByGroup.set(group.key, [y])
      assignedCostTerms.push(y.times(group.ingredientCost))
    })
    model.addConstraint(
      sum(...customerTerms).eq(1),
      `customer_${customerIndex}`,
    )
  })

  const xByMachineGroup = new Map<string, ReturnType<Model['intVar']>>()
  const productionUnitTerms: ReturnType<Model['intVar']>[] = []
  const productionCostTerms: ReturnType<ReturnType<Model['intVar']>['times']>[] = []

  ;[...machineGroups.entries()].forEach(([key, group], index) => {
    const x = model.intVar(
      0,
      Math.max(1, Math.ceil(group.eligibleCustomerIds.length / 2)),
      `x_${index}`,
    )
    xByMachineGroup.set(key, x)
    productionUnitTerms.push(x)
    productionCostTerms.push(x.times(group.ingredientCost))
  })

  ;[...assignmentGroups.values()].forEach((group, index) => {
    const capacityTerms = [...machineGroups.entries()]
      .filter(([, machineGroup]) => machineGroup.assignmentKey === group.key)
      .map(([key]) => xByMachineGroup.get(key)!.times(2))
    model.addConstraint(
      sum(...(assignmentsByGroup.get(group.key) ?? []))
        .minus(sum(...capacityTerms))
        .leq(0),
      `capacity_${index}`,
    )
  })

  model.addConstraint(
    sum(...productionUnitTerms).eq(35),
    'production_units_fix',
  )
  model.addConstraint(
    sum(...assignedCostTerms).eq(3853),
    'assigned_cost_fix',
  )
  model.addConstraint(
    sum(...productionCostTerms).eq(1948),
    'production_cost_fix',
  )

  const quantityTermsByEdgeKey = new Map<
    string,
    ReturnType<ReturnType<Model['intVar']>['times']>[]
  >()

  for (const [key, group] of machineGroups) {
    const x = xByMachineGroup.get(key)!
    if (collapseFinalizingIdentity) {
      quantityTermsByEdgeKey.set(
        `synthetic-final:${key}`,
        [x.times(1)],
      )
      continue
    }
    for (const [edgeKey, multiplicity] of group.edgeMultiplicity) {
      const terms = quantityTermsByEdgeKey.get(edgeKey)
      const term = x.times(multiplicity)
      if (terms) terms.push(term)
      else quantityTermsByEdgeKey.set(edgeKey, [term])
    }
  }

  const operationTerms: ReturnType<Model['intVar']>[] = []
  ;[...quantityTermsByEdgeKey.entries()].forEach(
    ([, quantityTerms], index) => {
      const op = model.intVar(0, 69, `op_${index}`)
      const quantity = sum(...quantityTerms)
      model.addConstraint(
        quantity
          .minus(op.times(PROCESSING_STACK_CAPACITY))
          .leq(0),
        `op_capacity_${index}`,
      )
      model.addConstraint(
        op.minus(quantity).leq(0),
        `op_usage_${index}`,
      )
      operationTerms.push(op)
    },
  )

  model.minimize(sum(...operationTerms))

  return {
    model,
    assignmentGroupCount: assignmentGroups.size,
    machineGroupCount: machineGroups.size,
    operationEdgeCount: quantityTermsByEdgeKey.size,
  }
}

async function boundedSolve(model: Model, timeLimitSeconds = 15) {
  const serializeStartedAt = performance.now()
  const mps = model.print('mps')
  const serializeMs = performance.now() - serializeStartedAt
  const highs = await HiGHS.create()
  try {
    const parseStartedAt = performance.now()
    await highs.parse(mps, 'mps')
    const parseMs = performance.now() - parseStartedAt
    highs.setParam('time_limit', timeLimitSeconds)
    const solveStartedAt = performance.now()
    const solution = await highs.solve()
    const solveMs = performance.now() - solveStartedAt
    return {
      status: solution.status,
      objective:
        typeof solution.objective === 'number' &&
        Number.isFinite(solution.objective)
          ? solution.objective
          : null,
      serializeMs,
      parseMs,
      solveMs,
    }
  } finally {
    highs.free()
  }
}

it(
  'profiles post-maximum-cost machine-operation quotient shapes',
  async () => {
    const domain = canonicalDomain()
    const assignmentGroups = new Set<string>()
    const throughSeasoningGroups = new Set<string>()
    const blendingGroups = new Set<string>()
    const combinedNonfinalGroups = new Set<string>()

    for (const recipe of domain.recipes) {
      const base = assignmentKey(recipe)
      assignmentGroups.add(base)
      throughSeasoningGroups.add(
        `${base}\\u001c${edgeSignature(
          recipe,
          new Set(['juicing', 'seasoning']),
        )}`,
      )
      blendingGroups.add(
        `${base}\\u001c${edgeSignature(
          recipe,
          new Set(['blending']),
        )}`,
      )
      combinedNonfinalGroups.add(
        `${base}\\u001c${edgeSignature(
          recipe,
          new Set(['juicing', 'seasoning', 'blending']),
        )}`,
      )
    }

    console.info(
      '[machine-quotient-shape]',
      JSON.stringify({
        recipeCount: domain.recipes.length,
        customerCount: domain.serviceableCustomerIds.length,
        assignmentGroupCount: assignmentGroups.size,
        throughSeasoningGroupCount: throughSeasoningGroups.size,
        blendingGroupCount: blendingGroups.size,
        finalizingGroupCount: assignmentGroups.size,
        combinedNonfinalGroupCount: combinedNonfinalGroups.size,
        finalizingEdgesAreRecipeIdentityUnique:
          finalizingEdgesAreRecipeIdentityUnique(domain),
      }),
    )

    const partitions = [
      {
        name: 'throughSeasoning',
        kinds: new Set<ProductionStepKind>(['juicing', 'seasoning']),
        collapseFinalizingIdentity: false,
      },
      {
        name: 'blending',
        kinds: new Set<ProductionStepKind>(['blending']),
        collapseFinalizingIdentity: false,
      },
      {
        name: 'finalizing',
        kinds: new Set<ProductionStepKind>(['finalizing']),
        collapseFinalizingIdentity: true,
      },
    ]

    for (const partition of partitions) {
      const buildStartedAt = performance.now()
      const built = buildPartitionQuotient(
        domain,
        partition.kinds,
        partition.collapseFinalizingIdentity,
      )
      const buildMs = performance.now() - buildStartedAt
      const solved = await boundedSolve(built.model)
      console.info(
        '[machine-quotient-partition]',
        JSON.stringify({
          name: partition.name,
          buildMs: Math.round(buildMs),
          assignmentGroupCount: built.assignmentGroupCount,
          machineGroupCount: built.machineGroupCount,
          operationEdgeCount: built.operationEdgeCount,
          serializeMs: Math.round(solved.serializeMs),
          parseMs: Math.round(solved.parseMs),
          solveMs: Math.round(solved.solveMs),
          status: solved.status,
          objective: solved.objective,
        }),
      )
    }

    expect(domain.recipes.length).toBe(7892)
    expect(domain.serviceableCustomerIds.length).toBe(69)
    expect(finalizingEdgesAreRecipeIdentityUnique(domain)).toBe(true)
  },
  180000,
)
