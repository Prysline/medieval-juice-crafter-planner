import { describe, expect, it } from 'vitest'
import type { RecipeCandidate } from '../types'
import {
  highsSolverAdapter,
  minimumWasteEquivalentAssignmentGroupingIsSafe,
} from './optimizerHighsSolver'
import type {
  BatchOptimizationModel,
  EligibleOptimizationRecipe,
  OptimizationCriterion,
} from './optimizerModel'
import type { ProductionPathEdge } from './productionPlan'

const CUSTOMER_IDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const
const GROUP_IDS = ['A', 'B', 'C'] as const
const PROCESSING_STACK_CAPACITY = 5
const MAX_ORACLE_PRODUCTION_UNITS = 4
const EXPECTED_TUPLE = [3, -24, 12, 5, 2] as const
const EXPECTED_WINNER_UNITS = {
  'A-shared:1': 1,
  'B-shared:2': 2,
} as const

type CustomerId = (typeof CUSTOMER_IDS)[number]
type GroupId = (typeof GROUP_IDS)[number]
type ExactTuple = [number, number, number, number, number]
type AggregateVector = [number, number, number]
type RecipeVector = number[]
type Assignment = { customerId: string; recipeId: string }

type SyntheticRecipe = EligibleOptimizationRecipe & {
  syntheticGroupId: GroupId
}

type ExactSubproblemResult =
  | {
      status: 'optimal'
      tuple: ExactTuple
      vector: RecipeVector
      assignments: Assignment[]
      identityAllocationsEnumerated: number
    }
  | {
      status: 'limit'
      identityAllocationsEnumerated: number
    }

const groupMasks: Record<GroupId, readonly CustomerId[]> = {
  A: ['a', 'b', 'c', 'd'],
  B: ['c', 'd', 'e', 'f'],
  C: ['a', 'b', 'e', 'f'],
}

function candidate(id: string): RecipeCandidate {
  return {
    id,
    name: id,
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: 10,
    ingredients: ['synthetic-base'],
    effects: [],
    equipment: [],
  }
}

function edge(
  key: string,
  kind: ProductionPathEdge['kind'],
): ProductionPathEdge {
  return {
    key,
    kind,
    equipment:
      kind === 'finalizing'
        ? '果汁成品台'
        : kind === 'seasoning'
          ? '調味器'
          : '榨汁機',
    fromIngredientIds: [`${key}:in`],
    toIngredientIds: [`${key}:out`],
  }
}

function repeatedEdges(
  key: string,
  kind: ProductionPathEdge['kind'],
  count: number,
): ProductionPathEdge[] {
  return Array.from({ length: count }, () => edge(key, kind))
}

/**
 * The production paths are intentionally synthetic. The common seasoning edge
 * appears twice in every identity. The exact winner therefore sends quantity
 * 2 * (1 + 2) = 6 through that edge, proving ceil(6 / 5) = 2 operations.
 *
 * A-shared:1 and B-shared:2 are deliberately non-representative identities.
 * Other identities keep the same prefix-equivalence fields but add one unique
 * machine edge, so machine-path identity is restored only by the exact
 * identity subproblem.
 */
function productionEdges(groupId: GroupId, identityIndex: number) {
  const common = repeatedEdges('common-repeat', 'seasoning', 2)
  const finish = [edge('finish-shared', 'finalizing')]

  if (groupId === 'A') {
    return [
      ...common,
      ...repeatedEdges('A-threshold', 'juicing', 3),
      ...finish,
      ...(identityIndex === 1
        ? []
        : [edge(`bad-A-${identityIndex}`, 'juicing')]),
    ]
  }

  if (groupId === 'B') {
    return [
      ...common,
      edge('B-edge', 'juicing'),
      ...finish,
      ...(identityIndex === 2
        ? []
        : [edge(`bad-B-${identityIndex}`, 'juicing')]),
    ]
  }

  return [
    ...common,
    ...repeatedEdges('C-threshold', 'juicing', 3),
    ...finish,
    edge(`bad-C-${identityIndex}`, 'juicing'),
  ]
}

function syntheticRecipes(): SyntheticRecipe[] {
  return GROUP_IDS.flatMap((groupId) =>
    Array.from({ length: 4 }, (_, identityIndex) => {
      const id = `${groupId}-shared:${identityIndex}`
      return {
        candidate: candidate(id),
        juiceUnitIngredientCost: 4,
        initialFinishedServings: 0,
        eligibleCustomerIds: [...groupMasks[groupId]],
        productionPath: {
          ingredientIds: [`synthetic-${groupId}`],
          edges: productionEdges(groupId, identityIndex),
        },
        syntheticGroupId: groupId,
      }
    }),
  )
}

function syntheticDomain(
  mutate?: (recipes: SyntheticRecipe[]) => void,
): BatchOptimizationModel {
  const recipes = syntheticRecipes()
  mutate?.(recipes)

  return {
    request: {
      customerIds: [...CUSTOMER_IDS],
      currentProgress: 'seasoner-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
        'ibex-statue': 999,
      },
      formalCustomerIds: [...CUSTOMER_IDS],
      candidatePolicy: 'observed-only',
      objective: 'minimum-waste',
      priorities: [
        'minimum-waste',
        'maximum-ingredient-cost',
      ],
      availableJuiceJarCount: 2,
    },
    serviceableCustomerIds: [...CUSTOMER_IDS],
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes,
  }
}

function lexCompare(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return left.length - right.length
}

function enumerateVectors(
  length: number,
  maxTotal: number,
): RecipeVector[] {
  const vector = Array.from({ length }, () => 0)
  const result: RecipeVector[] = []

  const visit = (index: number, remaining: number) => {
    if (index === length) {
      result.push([...vector])
      return
    }

    for (let value = 0; value <= remaining; value += 1) {
      vector[index] = value
      visit(index + 1, remaining - value)
    }
  }

  visit(0, maxTotal)
  return result
}

function exactCompositions(total: number, length: number): number[][] {
  const vector = Array.from({ length }, () => 0)
  const result: number[][] = []

  const visit = (index: number, remaining: number) => {
    if (index === length - 1) {
      vector[index] = remaining
      result.push([...vector])
      return
    }

    for (let value = 0; value <= remaining; value += 1) {
      vector[index] = value
      visit(index + 1, remaining - value)
    }
  }

  visit(0, total)
  return result
}

function assignmentsForVector(
  recipes: readonly SyntheticRecipe[],
  vector: readonly number[],
): Assignment[] | null {
  const remainingCapacity = vector.map((units) => units * 2)
  const assignments: Assignment[] = []
  let best: Assignment[] | null = null
  let bestKinds = Number.POSITIVE_INFINITY
  let bestSignature = ''

  const eligibleRecipeIndexes = CUSTOMER_IDS.map((customerId) =>
    recipes.flatMap((recipe, recipeIndex) =>
      vector[recipeIndex] > 0 &&
      recipe.eligibleCustomerIds.includes(customerId)
        ? [recipeIndex]
        : [],
    ),
  )
  if (eligibleRecipeIndexes.some((indexes) => indexes.length === 0)) {
    return null
  }

  const customerOrder = CUSTOMER_IDS.map((_, index) => index)
    .sort(
      (left, right) =>
        eligibleRecipeIndexes[left].length - eligibleRecipeIndexes[right].length,
    )

  const visit = (orderIndex: number) => {
    if (orderIndex === customerOrder.length) {
      const byCustomer = [...assignments].sort(
        (left, right) =>
          CUSTOMER_IDS.indexOf(left.customerId as CustomerId) -
          CUSTOMER_IDS.indexOf(right.customerId as CustomerId),
      )
      const kinds = new Set(byCustomer.map((entry) => entry.recipeId)).size
      const signature = byCustomer
        .map((entry) => `${entry.customerId}:${entry.recipeId}`)
        .join('|')
      if (
        kinds < bestKinds ||
        (kinds === bestKinds && (best === null || signature < bestSignature))
      ) {
        best = byCustomer
        bestKinds = kinds
        bestSignature = signature
      }
      return
    }

    const customerIndex = customerOrder[orderIndex]
    const customerId = CUSTOMER_IDS[customerIndex]
    for (const recipeIndex of eligibleRecipeIndexes[customerIndex]) {
      if (remainingCapacity[recipeIndex] <= 0) continue
      remainingCapacity[recipeIndex] -= 1
      assignments.push({
        customerId,
        recipeId: recipes[recipeIndex].candidate.id,
      })
      visit(orderIndex + 1)
      assignments.pop()
      remainingCapacity[recipeIndex] += 1
    }
  }

  visit(0)
  return best
}

function machineOperationsForVector(
  recipes: readonly SyntheticRecipe[],
  vector: readonly number[],
) {
  const quantityByEdgeKey = new Map<string, number>()
  recipes.forEach((recipe, recipeIndex) => {
    const units = vector[recipeIndex]
    if (units <= 0) return
    const multiplicityByEdgeKey = new Map<string, number>()
    for (const productionEdge of recipe.productionPath.edges) {
      multiplicityByEdgeKey.set(
        productionEdge.key,
        (multiplicityByEdgeKey.get(productionEdge.key) ?? 0) + 1,
      )
    }
    for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
      quantityByEdgeKey.set(
        edgeKey,
        (quantityByEdgeKey.get(edgeKey) ?? 0) + units * multiplicity,
      )
    }
  })

  const total = [...quantityByEdgeKey.values()].reduce(
    (sum, quantity) =>
      sum + Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    0,
  )
  return { total, quantityByEdgeKey }
}

function tupleForVector(
  recipes: readonly SyntheticRecipe[],
  vector: readonly number[],
  assignments: readonly Assignment[],
): ExactTuple {
  const productionUnits = vector.reduce((sum, units) => sum + units, 0)
  const assignedIngredientCost = assignments.reduce((sum, assignment) => {
    const recipe = recipes.find(
      (entry) => entry.candidate.id === assignment.recipeId,
    )
    if (!recipe) throw new Error(`Unknown assignment recipe ${assignment.recipeId}`)
    return sum + recipe.juiceUnitIngredientCost
  }, 0)
  const productionCost = recipes.reduce(
    (sum, recipe, recipeIndex) =>
      sum + vector[recipeIndex] * recipe.juiceUnitIngredientCost,
    0,
  )
  const machineOperations = machineOperationsForVector(recipes, vector).total
  const assignmentUsedKinds = new Set(
    assignments.map((assignment) => assignment.recipeId),
  ).size

  return [
    productionUnits,
    -assignedIngredientCost,
    productionCost,
    machineOperations,
    assignmentUsedKinds,
  ]
}

function exhaustiveOracle(recipes: readonly SyntheticRecipe[]) {
  const vectors = enumerateVectors(
    recipes.length,
    MAX_ORACLE_PRODUCTION_UNITS,
  )
  let feasible = 0
  let best:
    | {
        tuple: ExactTuple
        vector: RecipeVector
        assignments: Assignment[]
      }
    | undefined

  for (const vector of vectors) {
    const assignments = assignmentsForVector(recipes, vector)
    if (!assignments) continue
    feasible += 1
    const tuple = tupleForVector(recipes, vector, assignments)
    if (!best || lexCompare(tuple, best.tuple) < 0) {
      best = { tuple, vector, assignments }
    }
  }

  if (!best) throw new Error('Synthetic oracle found no feasible vector')
  return { totalVectors: vectors.length, feasible, ...best }
}

function aggregateVectorForRecipeVector(
  recipes: readonly SyntheticRecipe[],
  vector: readonly number[],
): AggregateVector {
  const aggregate: AggregateVector = [0, 0, 0]
  recipes.forEach((recipe, recipeIndex) => {
    const groupIndex = GROUP_IDS.indexOf(recipe.syntheticGroupId)
    aggregate[groupIndex] += vector[recipeIndex]
  })
  return aggregate
}

function recipeVectorsForAggregate(
  aggregate: AggregateVector,
): RecipeVector[] {
  const byGroup = aggregate.map((units) => exactCompositions(units, 4))
  return byGroup[0].flatMap((a) =>
    byGroup[1].flatMap((b) =>
      byGroup[2].map((c) => [...a, ...b, ...c]),
    ),
  )
}

function structuralAggregateIsFeasible(
  recipes: readonly SyntheticRecipe[],
  aggregate: AggregateVector,
) {
  return recipeVectorsForAggregate(aggregate).some(
    (vector) => assignmentsForVector(recipes, vector) !== null,
  )
}

function masterStates(): AggregateVector[] {
  const states: AggregateVector[] = []
  for (let a = 0; a <= 2; a += 1) {
    for (let b = 0; b <= 2; b += 1) {
      for (let c = 0; c <= 2; c += 1) {
        const total = a + b + c
        if (total < 1 || total > 3) continue
        states.push([a, b, c])
      }
    }
  }
  return states
}

function structuralStates(
  recipes: readonly SyntheticRecipe[],
): AggregateVector[] {
  return masterStates().filter(
    (aggregate) =>
      aggregate[0] + aggregate[1] + aggregate[2] === 3 &&
      structuralAggregateIsFeasible(recipes, aggregate),
  )
}

function exactIdentitySubproblem(
  recipes: readonly SyntheticRecipe[],
  aggregate: AggregateVector,
  allocationBudget = Number.POSITIVE_INFINITY,
): ExactSubproblemResult {
  const allocations = recipeVectorsForAggregate(aggregate)
  let enumerated = 0
  let best:
    | {
        tuple: ExactTuple
        vector: RecipeVector
        assignments: Assignment[]
      }
    | undefined

  for (const vector of allocations) {
    if (enumerated >= allocationBudget) {
      return {
        status: 'limit',
        identityAllocationsEnumerated: enumerated,
      }
    }
    enumerated += 1
    const assignments = assignmentsForVector(recipes, vector)
    if (!assignments) continue
    const tuple = tupleForVector(recipes, vector, assignments)
    if (!best || lexCompare(tuple, best.tuple) < 0) {
      best = { tuple, vector, assignments }
    }
  }

  if (!best) {
    throw new Error(`No exact identity allocation for ${aggregate.join(',')}`)
  }
  return {
    status: 'optimal',
    ...best,
    identityAllocationsEnumerated: enumerated,
  }
}

function structuralCutKey(
  aggregate: AggregateVector,
  assignedCustomerCount: number,
  assignmentState: readonly number[],
) {
  return JSON.stringify({
    aggregate,
    assignedCustomerCount,
    assignmentState,
  })
}

function prefixEquivalenceKey(recipe: EligibleOptimizationRecipe) {
  return JSON.stringify({
    eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
    juiceUnitIngredientCost: recipe.juiceUnitIngredientCost,
    initialFinishedServings: recipe.initialFinishedServings ?? 0,
    maxProductionUnits: recipe.maxProductionUnits ?? null,
  })
}

function verifyWitness(
  domain: BatchOptimizationModel,
  assignments: readonly Assignment[],
  productionUnitsByRecipeId: Readonly<Record<string, number>>,
) {
  const recipes = domain.recipes as SyntheticRecipe[]
  expect(assignments).toHaveLength(CUSTOMER_IDS.length)
  expect(new Set(assignments.map((entry) => entry.customerId))).toEqual(
    new Set(CUSTOMER_IDS),
  )

  const assignedByRecipeId = new Map<string, number>()
  for (const assignment of assignments) {
    const recipe = recipes.find(
      (entry) => entry.candidate.id === assignment.recipeId,
    )
    expect(recipe).toBeDefined()
    expect(recipe?.eligibleCustomerIds).toContain(assignment.customerId)
    assignedByRecipeId.set(
      assignment.recipeId,
      (assignedByRecipeId.get(assignment.recipeId) ?? 0) + 1,
    )
  }

  for (const recipe of recipes) {
    const units = productionUnitsByRecipeId[recipe.candidate.id] ?? 0
    const availableServings =
      (recipe.initialFinishedServings ?? 0) + units * 2
    expect(assignedByRecipeId.get(recipe.candidate.id) ?? 0)
      .toBeLessThanOrEqual(availableServings)
    if (recipe.maxProductionUnits !== undefined) {
      expect(units).toBeLessThanOrEqual(recipe.maxProductionUnits)
    }
  }

  const vector = recipes.map(
    (recipe) => productionUnitsByRecipeId[recipe.candidate.id] ?? 0,
  )
  const tuple = tupleForVector(recipes, vector, assignments)
  expect(tuple).toEqual(EXPECTED_TUPLE)
  return tuple
}

function adapterTuple(
  domain: BatchOptimizationModel,
  solution: Awaited<ReturnType<typeof highsSolverAdapter.solve>>,
): ExactTuple {
  const recipeById = new Map(
    domain.recipes.map((recipe) => [recipe.candidate.id, recipe]),
  )
  const assignedIngredientCost = solution.assignments.reduce(
    (sum, assignment) =>
      sum +
      (recipeById.get(assignment.recipeId)?.juiceUnitIngredientCost ?? 0),
    0,
  )
  return [
    solution.metrics.totalProductionUnits,
    -assignedIngredientCost,
    solution.metrics.totalIngredientCost,
    solution.metrics.machineOperations,
    solution.metrics.recipeKinds,
  ]
}

function runSyntheticLbbd(
  recipes: readonly SyntheticRecipe[],
  incumbent: ReturnType<typeof exhaustiveOracle>,
  options: {
    controllerSubproblemLimit?: number
    identityAllocationBudget?: number
  } = {},
) {
  const incumbentAggregate = aggregateVectorForRecipeVector(
    recipes,
    incumbent.vector,
  )
  const competingStates = structuralStates(recipes).filter(
    (aggregate) => aggregate.join(',') !== incumbentAggregate.join(','),
  )
  const maxCalls = options.controllerSubproblemLimit ?? Number.POSITIVE_INFINITY
  const cuts = new Set<string>()
  let exactIdentitySubproblemCalls = 0

  for (const aggregate of competingStates) {
    if (exactIdentitySubproblemCalls >= maxCalls) {
      return {
        status: 'limit' as const,
        exactIdentitySubproblemCalls,
        structuralCuts: cuts.size,
        closure: false,
      }
    }

    const result = exactIdentitySubproblem(
      recipes,
      aggregate,
      options.identityAllocationBudget,
    )
    exactIdentitySubproblemCalls += 1
    if (result.status === 'limit') {
      return {
        status: 'limit' as const,
        exactIdentitySubproblemCalls,
        structuralCuts: cuts.size,
        closure: false,
      }
    }

    if (lexCompare(result.tuple, incumbent.tuple) <= 0) {
      throw new Error(
        `Unexpected competing aggregate ${aggregate.join(',')} is not worse than incumbent`,
      )
    }

    const assignmentCounts = GROUP_IDS.map((groupId) =>
      result.assignments.filter((assignment) => {
        const recipe = recipes.find(
          (entry) => entry.candidate.id === assignment.recipeId,
        )
        return recipe?.syntheticGroupId === groupId
      }).length,
    )
    cuts.add(
      structuralCutKey(
        aggregate,
        result.assignments.length,
        assignmentCounts,
      ),
    )
  }

  return {
    status: 'optimal' as const,
    exactIdentitySubproblemCalls,
    structuralCuts: cuts.size,
    closure: cuts.size === competingStates.length,
  }
}

function expectedPriorities(): OptimizationCriterion[] {
  return ['minimum-waste', 'maximum-ingredient-cost']
}

describe('Phase E synthetic LBBD correctness prototype', () => {
  it('matches the exhaustive oracle and preserves the non-representative exact identities', () => {
    const recipes = syntheticRecipes()
    const oracle = exhaustiveOracle(recipes)

    expect(oracle.totalVectors).toBe(1820)
    expect(oracle.feasible).toBe(1564)
    expect(oracle.tuple).toEqual(EXPECTED_TUPLE)

    const selected = Object.fromEntries(
      recipes.flatMap((recipe, recipeIndex) =>
        oracle.vector[recipeIndex] > 0
          ? [[recipe.candidate.id, oracle.vector[recipeIndex]]]
          : [],
      ),
    )
    expect(selected).toEqual(EXPECTED_WINNER_UNITS)
    expect(oracle.assignments).toHaveLength(6)
    expect(new Set(oracle.assignments.map((entry) => entry.recipeId)).size).toBe(2)

    const operations = machineOperationsForVector(recipes, oracle.vector)
    expect(operations.quantityByEdgeKey.get('common-repeat')).toBe(6)
    expect(Math.ceil(6 / PROCESSING_STACK_CAPACITY)).toBe(2)
    expect(operations.total).toBe(5)
  })

  it('has 16 prefix master states, 7 structural states, and no identity-allocation loss', () => {
    const recipes = syntheticRecipes()
    const masters = masterStates()
    const structural = structuralStates(recipes)

    expect(masters).toHaveLength(16)
    expect(structural).toHaveLength(7)

    const probe = exactIdentitySubproblem(recipes, [1, 1, 1])
    expect(probe.status).toBe('optimal')
    if (probe.status === 'optimal') {
      expect(probe.identityAllocationsEnumerated).toBe(64)
    }

    const seenIdentityIds = new Set<string>()
    for (const vector of recipeVectorsForAggregate([1, 1, 1])) {
      vector.forEach((units, recipeIndex) => {
        if (units > 0) seenIdentityIds.add(recipes[recipeIndex].candidate.id)
      })
    }
    expect(seenIdentityIds).toEqual(
      new Set(recipes.map((recipe) => recipe.candidate.id)),
    )
  })

  it('closes LB/UB after six exact competing structural cuts', () => {
    const recipes = syntheticRecipes()
    const oracle = exhaustiveOracle(recipes)
    const lbbd = runSyntheticLbbd(recipes, oracle)

    expect(lbbd).toEqual({
      status: 'optimal',
      exactIdentitySubproblemCalls: 6,
      structuralCuts: 6,
      closure: true,
    })
  })

  it('keys cuts by aggregate production and assignment structural state', () => {
    const aggregate: AggregateVector = [1, 1, 1]
    const sameAggregateDifferentAssignmentA = structuralCutKey(
      aggregate,
      6,
      [2, 2, 2],
    )
    const sameAggregateDifferentAssignmentB = structuralCutKey(
      aggregate,
      5,
      [2, 2, 1],
    )
    expect(sameAggregateDifferentAssignmentA)
      .not.toBe(sameAggregateDifferentAssignmentB)
  })

  it('splits only prefix-equivalence fields, not machine path or sale price', () => {
    const base = syntheticRecipes()[0]
    const clone = (): EligibleOptimizationRecipe => ({
      ...base,
      candidate: {
        ...base.candidate,
        ingredients: [...base.candidate.ingredients],
        effects: [...base.candidate.effects],
      },
      eligibleCustomerIds: [...base.eligibleCustomerIds],
      productionPath: {
        ingredientIds: [...base.productionPath.ingredientIds],
        edges: base.productionPath.edges.map((entry) => ({ ...entry })),
      },
    })

    const eligibleMutation = clone()
    eligibleMutation.eligibleCustomerIds = ['a']
    expect(prefixEquivalenceKey(eligibleMutation)).not.toBe(prefixEquivalenceKey(base))

    const costMutation = clone()
    costMutation.juiceUnitIngredientCost += 1
    expect(prefixEquivalenceKey(costMutation)).not.toBe(prefixEquivalenceKey(base))

    const stockMutation = clone()
    stockMutation.initialFinishedServings = 1
    expect(prefixEquivalenceKey(stockMutation)).not.toBe(prefixEquivalenceKey(base))

    const capMutation = clone()
    capMutation.maxProductionUnits = 4
    expect(prefixEquivalenceKey(capMutation)).not.toBe(prefixEquivalenceKey(base))

    const machineMutation = clone()
    machineMutation.productionPath.edges.push(edge('machine-only-mutation', 'juicing'))
    expect(prefixEquivalenceKey(machineMutation)).toBe(prefixEquivalenceKey(base))

    const saleMutation = clone()
    saleMutation.candidate.salePrice = 999
    expect(prefixEquivalenceKey(saleMutation)).toBe(prefixEquivalenceKey(base))
  })

  it('refuses current aggregate grouping for identity-sensitive hard state', () => {
    const plain = syntheticDomain()
    expect(minimumWasteEquivalentAssignmentGroupingIsSafe(plain)).toBe(true)

    const capped = syntheticDomain((recipes) => {
      recipes[0].maxProductionUnits = 4
    })
    expect(minimumWasteEquivalentAssignmentGroupingIsSafe(capped)).toBe(false)

    const inventoryOnly = syntheticDomain()
    inventoryOnly.request.materialSourceMode = 'inventory-only'
    inventoryOnly.request.materialInventory = {
      ingredientUnits: {},
      intermediateJuiceUnits: {},
    }
    expect(minimumWasteEquivalentAssignmentGroupingIsSafe(inventoryOnly)).toBe(false)

    const filledJar = syntheticDomain()
    filledJar.request.initialAvailableJuiceJars = [
      { recipeId: 'A-shared:1', servings: 1 },
    ]
    expect(minimumWasteEquivalentAssignmentGroupingIsSafe(filledJar)).toBe(false)

    const jarReuseHardLimit = syntheticDomain()
    jarReuseHardLimit.request.constraints = { maxJarTypeSwitches: 0 }
    expect(minimumWasteEquivalentAssignmentGroupingIsSafe(jarReuseHardLimit)).toBe(false)
  })

  it('preserves controller and subproblem limit semantics without false cuts', () => {
    const recipes = syntheticRecipes()
    const oracle = exhaustiveOracle(recipes)

    const controllerLimited = runSyntheticLbbd(recipes, oracle, {
      controllerSubproblemLimit: 2,
    })
    expect(controllerLimited.status).toBe('limit')
    expect(controllerLimited.closure).toBe(false)
    expect(controllerLimited.structuralCuts).toBe(2)

    const subproblemLimited = runSyntheticLbbd(recipes, oracle, {
      identityAllocationBudget: 39,
    })
    expect(subproblemLimited.status).toBe('limit')
    expect(subproblemLimited.closure).toBe(false)
    expect(subproblemLimited.exactIdentitySubproblemCalls).toBe(1)
    expect(subproblemLimited.structuralCuts).toBe(0)
  })

  it('matches current highsSolverAdapter to the exhaustive oracle and independent witness verifier', async () => {
    const domain = syntheticDomain()
    const recipes = domain.recipes as SyntheticRecipe[]
    const oracle = exhaustiveOracle(recipes)
    const solution = await highsSolverAdapter.solve(
      domain,
      expectedPriorities(),
    )

    expect(adapterTuple(domain, solution)).toEqual(oracle.tuple)
    expect(adapterTuple(domain, solution)).toEqual(EXPECTED_TUPLE)
    expect(solution.assignments).toHaveLength(6)
    expect(solution.productionUnitsByRecipeId).toEqual(EXPECTED_WINNER_UNITS)
    expect(solution.metrics.recipeKinds).toBe(2)
    verifyWitness(
      domain,
      solution.assignments,
      solution.productionUnitsByRecipeId,
    )
  })

  it('uses the actual adapter generic exact fallback when maxProductionUnits disables grouping', async () => {
    const domain = syntheticDomain((recipes) => {
      // Deliberately put the loose cap on a non-winning identity.
      recipes.find((recipe) => recipe.candidate.id === 'A-shared:0')!
        .maxProductionUnits = 4
    })
    expect(minimumWasteEquivalentAssignmentGroupingIsSafe(domain)).toBe(false)

    const solution = await highsSolverAdapter.solve(
      domain,
      expectedPriorities(),
    )

    expect(adapterTuple(domain, solution)).toEqual(EXPECTED_TUPLE)
    expect(solution.assignments).toHaveLength(6)
    expect(solution.productionUnitsByRecipeId).toEqual(EXPECTED_WINNER_UNITS)
    expect(solution.metrics.recipeKinds).toBe(2)
    verifyWitness(
      domain,
      solution.assignments,
      solution.productionUnitsByRecipeId,
    )
  })
})
