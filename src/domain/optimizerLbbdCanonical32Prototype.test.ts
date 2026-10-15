import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import {
  solvePostMaximumIngredientCostMachineCertificateForDiagnosis,
  type PostMaximumIngredientCostMachineCertificateDiagnosis,
} from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
}

const enabled = process.env.OPTIMIZER_PHASE_G_CANONICAL32_PROTOTYPE === '1'
const CUSTOMER_COUNT = 32
const EXPECTED_PREFIX = {
  productionUnits: 16,
  assignedIngredientCost: 1798,
  productionCost: 899,
} as const
const EXPECTED_MACHINE_OPERATIONS = 55
const EXPECTED_RECIPE_KINDS = 15

type RecipeUnitSelection = {
  recipeId: string
  units: number
}

type MasterGroupAssignment = {
  customerId: string
  groupKey: string
}

type IdentityAssignment = {
  customerId: string
  recipeId: string
}

interface ExactEquivalenceGroup {
  key: string
  eligibleCustomerIds: string[]
  juiceUnitIngredientCost: number
  initialFinishedServings: number
  maxProductionUnits: number | null
  recipes: EligibleOptimizationRecipe[]
}

function currentWorldRequest(): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const availableCustomerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
  const customerIds = availableCustomerIds.slice(0, CUSTOMER_COUNT)

  return {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 9999,
      'tranquil-fountain': 9999,
      'ibex-statue': 9999,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-waste',
    priorities: ['minimum-waste', 'maximum-ingredient-cost'],
    availableJuiceJarCount: 5,
  }
}

function prefixEquivalenceKey(recipe: EligibleOptimizationRecipe) {
  return JSON.stringify({
    eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
    juiceUnitIngredientCost: recipe.juiceUnitIngredientCost,
    initialFinishedServings: recipe.initialFinishedServings ?? 0,
    maxProductionUnits: recipe.maxProductionUnits ?? null,
  })
}

function exactEquivalenceGroups(
  domain: BatchOptimizationModel,
): ExactEquivalenceGroup[] {
  const groups = new Map<string, ExactEquivalenceGroup>()
  for (const recipe of domain.recipes) {
    const key = prefixEquivalenceKey(recipe)
    const existing = groups.get(key)
    if (existing) {
      existing.recipes.push(recipe)
      continue
    }
    groups.set(key, {
      key,
      eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
      juiceUnitIngredientCost: recipe.juiceUnitIngredientCost,
      initialFinishedServings: recipe.initialFinishedServings ?? 0,
      maxProductionUnits: recipe.maxProductionUnits ?? null,
      recipes: [recipe],
    })
  }
  return [...groups.values()]
}

function projectWitnessToMaster(
  groups: readonly ExactEquivalenceGroup[],
  witness: readonly RecipeUnitSelection[],
) {
  const groupByRecipeId = new Map<string, ExactEquivalenceGroup>()
  for (const group of groups) {
    for (const recipe of group.recipes) {
      groupByRecipeId.set(recipe.candidate.id, group)
    }
  }

  const unitsByGroupKey = new Map<string, number>()
  for (const selection of witness) {
    const group = groupByRecipeId.get(selection.recipeId)
    if (!group) {
      throw new Error(`Phase G witness recipe outside dynamic master: ${selection.recipeId}`)
    }
    unitsByGroupKey.set(
      group.key,
      (unitsByGroupKey.get(group.key) ?? 0) + selection.units,
    )
  }
  return unitsByGroupKey
}

async function solveFixedAggregateMasterAssignments(
  domain: BatchOptimizationModel,
  groups: readonly ExactEquivalenceGroup[],
  unitsByGroupKey: ReadonlyMap<string, number>,
) {
  const model = new Model()
  const activeGroups = groups.filter(
    (group) => (unitsByGroupKey.get(group.key) ?? 0) > 0,
  )
  const yByCustomerGroup = new Map<string, ReturnType<Model['boolVar']>>()
  let constraintCount = 0

  domain.serviceableCustomerIds.forEach((customerId, customerIndex) => {
    const vars = activeGroups.flatMap((group, groupIndex) => {
      if (!group.eligibleCustomerIds.includes(customerId)) return []
      const variable = model.boolVar(`master_y_${customerIndex}_${groupIndex}`)
      yByCustomerGroup.set(`${customerId}\u001f${group.key}`, variable)
      return [variable]
    })
    model.addConstraint(sum(...vars).eq(1), `master_customer_${customerIndex}`)
    constraintCount += 1
  })

  activeGroups.forEach((group, groupIndex) => {
    const units = unitsByGroupKey.get(group.key) ?? 0
    const vars = group.eligibleCustomerIds.flatMap((customerId) => {
      const variable = yByCustomerGroup.get(`${customerId}\u001f${group.key}`)
      return variable ? [variable] : []
    })
    const availableServings = group.initialFinishedServings + units * 2
    model.addConstraint(
      sum(...vars).eq(availableServings),
      `master_group_capacity_${groupIndex}`,
    )
    constraintCount += 1
  })

  const assignedIngredientCost = sum(
    ...[...yByCustomerGroup.entries()].map(([key, variable]) => {
      const groupKey = key.slice(key.indexOf('\u001f') + 1)
      const group = groups.find((entry) => entry.key === groupKey)
      if (!group) throw new Error(`Missing Phase G master group ${groupKey}`)
      return variable.times(group.juiceUnitIngredientCost)
    }),
  )
  model.addConstraint(
    assignedIngredientCost.eq(EXPECTED_PREFIX.assignedIngredientCost),
    'master_assigned_ingredient_cost',
  )
  constraintCount += 1
  model.minimize(sum(...yByCustomerGroup.values()))

  const solution = await model.solve()
  if (solution.status !== 'optimal') {
    throw new Error(`Phase G master assignment status: ${solution.status}`)
  }

  const assignments: MasterGroupAssignment[] = domain.serviceableCustomerIds.map(
    (customerId) => {
      const selected = activeGroups.filter((group) => {
        const variable = yByCustomerGroup.get(`${customerId}\u001f${group.key}`)
        return variable ? (solution.getValue(variable) ?? 0) > 0.5 : false
      })
      if (selected.length !== 1) {
        throw new Error(
          `Phase G master assignment count for ${customerId}: ${selected.length}`,
        )
      }
      return { customerId, groupKey: selected[0].key }
    },
  )

  return {
    assignments,
    variableCount: yByCustomerGroup.size,
    constraintCount,
    activeGroupCount: activeGroups.length,
  }
}

function reconstructIdentityAssignments(
  groups: readonly ExactEquivalenceGroup[],
  masterAssignments: readonly MasterGroupAssignment[],
  witness: readonly RecipeUnitSelection[],
): IdentityAssignment[] {
  const recipeById = new Map(
    groups.flatMap((group) =>
      group.recipes.map((recipe) => [recipe.candidate.id, recipe] as const),
    ),
  )
  const groupByRecipeId = new Map(
    groups.flatMap((group) =>
      group.recipes.map((recipe) => [recipe.candidate.id, group] as const),
    ),
  )
  const selectionsByGroupKey = new Map<string, RecipeUnitSelection[]>()
  for (const selection of witness.filter((entry) => entry.units > 0)) {
    const group = groupByRecipeId.get(selection.recipeId)
    if (!group) throw new Error(`Missing Phase G witness group ${selection.recipeId}`)
    const current = selectionsByGroupKey.get(group.key) ?? []
    current.push(selection)
    selectionsByGroupKey.set(group.key, current)
  }

  const result: IdentityAssignment[] = []
  for (const group of groups) {
    const customers = masterAssignments
      .filter((assignment) => assignment.groupKey === group.key)
      .map((assignment) => assignment.customerId)
      .sort()
    if (customers.length === 0) continue

    const selections = [...(selectionsByGroupKey.get(group.key) ?? [])]
      .sort((left, right) => left.recipeId.localeCompare(right.recipeId))
    let customerIndex = 0
    for (const selection of selections) {
      const recipe = recipeById.get(selection.recipeId)
      if (!recipe) throw new Error(`Missing Phase G witness recipe ${selection.recipeId}`)
      const capacity = (recipe.initialFinishedServings ?? 0) + selection.units * 2
      for (let slot = 0; slot < capacity; slot += 1) {
        const customerId = customers[customerIndex]
        if (!customerId) {
          throw new Error(`Phase G witness over-capacity for group ${group.key}`)
        }
        if (!recipe.eligibleCustomerIds.includes(customerId)) {
          throw new Error(
            `Phase G reconstructed ineligible assignment ${customerId}/${selection.recipeId}`,
          )
        }
        result.push({ customerId, recipeId: selection.recipeId })
        customerIndex += 1
      }
    }
    if (customerIndex !== customers.length) {
      throw new Error(`Phase G witness under-capacity for group ${group.key}`)
    }
  }
  return result
}

function independentWitnessMetrics(
  domain: BatchOptimizationModel,
  assignments: readonly IdentityAssignment[],
  witness: readonly RecipeUnitSelection[],
) {
  const recipeById = new Map(
    domain.recipes.map((recipe) => [recipe.candidate.id, recipe]),
  )
  const unitsByRecipeId = new Map(
    witness.map((selection) => [selection.recipeId, selection.units]),
  )
  const edgeQuantity = new Map<string, number>()

  let productionUnits = 0
  let productionCost = 0
  for (const selection of witness) {
    const recipe = recipeById.get(selection.recipeId)
    if (!recipe) throw new Error(`Unknown Phase G witness recipe ${selection.recipeId}`)
    productionUnits += selection.units
    productionCost += selection.units * recipe.juiceUnitIngredientCost
    for (const edge of recipe.productionPath.edges) {
      edgeQuantity.set(
        edge.key,
        (edgeQuantity.get(edge.key) ?? 0) + selection.units,
      )
    }
  }

  let assignedIngredientCost = 0
  const assignedCountByRecipeId = new Map<string, number>()
  for (const assignment of assignments) {
    const recipe = recipeById.get(assignment.recipeId)
    if (!recipe) throw new Error(`Unknown Phase G assignment recipe ${assignment.recipeId}`)
    if (!recipe.eligibleCustomerIds.includes(assignment.customerId)) {
      throw new Error(
        `Ineligible Phase G assignment ${assignment.customerId}/${assignment.recipeId}`,
      )
    }
    assignedIngredientCost += recipe.juiceUnitIngredientCost
    assignedCountByRecipeId.set(
      assignment.recipeId,
      (assignedCountByRecipeId.get(assignment.recipeId) ?? 0) + 1,
    )
  }

  for (const [recipeId, assignedCount] of assignedCountByRecipeId) {
    const recipe = recipeById.get(recipeId)
    if (!recipe) throw new Error(`Unknown Phase G capacity recipe ${recipeId}`)
    const servings =
      (recipe.initialFinishedServings ?? 0) +
      (unitsByRecipeId.get(recipeId) ?? 0) * 2
    if (assignedCount > servings) {
      throw new Error(`Phase G assignment exceeds capacity for ${recipeId}`)
    }
  }

  const machineOperations = [...edgeQuantity.values()].reduce(
    (total, quantity) =>
      total + Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
    0,
  )

  return {
    productionUnits,
    assignedIngredientCost,
    productionCost,
    machineOperations,
    recipeKinds: new Set(assignments.map((assignment) => assignment.recipeId)).size,
  }
}

function prototypeDisposition(
  diagnosis:
    | PostMaximumIngredientCostMachineCertificateDiagnosis
    | null
    | 'limit',
) {
  if (diagnosis === null || diagnosis === 'limit') {
    return { status: 'fallback-required' as const }
  }
  const certificate = diagnosis.combinedCertificate ?? diagnosis.certificate
  return certificate
    ? { status: 'certificate-ready' as const, certificate }
    : { status: 'fallback-required' as const }
}

describe.skipIf(!enabled)('Phase G canonical-32 LBBD prototype', () => {
  it(
    'closes canonical-32 and records structural scaling evidence',
    async () => {
      const request = currentWorldRequest()
      const candidatePool = buildRecipeCandidatePool(request.currentProgress)
      const domain = buildOptimizationModel(request, {
        customers: canonicalCustomers,
        candidatePool,
      })
      const groups = exactEquivalenceGroups(domain)
      const assignmentEdges = domain.recipes.reduce(
        (total, recipe) =>
          total +
          recipe.eligibleCustomerIds.filter((customerId) =>
            domain.serviceableCustomerIds.includes(customerId),
          ).length,
        0,
      )
      const productionEdges = domain.recipes.reduce(
        (total, recipe) => total + recipe.productionPath.edges.length,
        0,
      )

      const startedAt = performance.now()
      const certificateStartedAt = performance.now()
      const diagnosis =
        await solvePostMaximumIngredientCostMachineCertificateForDiagnosis(domain)
      const certificateMs = performance.now() - certificateStartedAt
      const disposition = prototypeDisposition(diagnosis)
      expect(disposition.status).toBe('certificate-ready')
      if (disposition.status !== 'certificate-ready' || !diagnosis) return

      expect(diagnosis.prefix).toEqual(EXPECTED_PREFIX)
      expect(disposition.certificate.optimum).toBe(EXPECTED_MACHINE_OPERATIONS)
      expect(diagnosis.combinedCertificate?.recipeKindsOptimum).toBe(
        EXPECTED_RECIPE_KINDS,
      )
      expect(disposition.certificate.verifiedAssignmentCount).toBe(CUSTOMER_COUNT)

      const witness = disposition.certificate.witnessRecipeUnits.filter(
        (selection) => selection.units > 0,
      )
      const masterStartedAt = performance.now()
      const unitsByGroupKey = projectWitnessToMaster(groups, witness)
      const master = await solveFixedAggregateMasterAssignments(
        domain,
        groups,
        unitsByGroupKey,
      )
      const identityAssignments = reconstructIdentityAssignments(
        groups,
        master.assignments,
        witness,
      )
      const metrics = independentWitnessMetrics(
        domain,
        identityAssignments,
        witness,
      )
      const masterAndWitnessMs = performance.now() - masterStartedAt
      const wallMs = performance.now() - startedAt

      expect(identityAssignments).toHaveLength(CUSTOMER_COUNT)
      expect(new Set(identityAssignments.map((entry) => entry.customerId))).toEqual(
        new Set(domain.serviceableCustomerIds),
      )
      expect(metrics).toEqual({
        productionUnits: EXPECTED_PREFIX.productionUnits,
        assignedIngredientCost: EXPECTED_PREFIX.assignedIngredientCost,
        productionCost: EXPECTED_PREFIX.productionCost,
        machineOperations: EXPECTED_MACHINE_OPERATIONS,
        recipeKinds: EXPECTED_RECIPE_KINDS,
      })
      expect(master.activeGroupCount).toBe(unitsByGroupKey.size)
      expect([...unitsByGroupKey.values()].reduce((a, b) => a + b, 0)).toBe(
        EXPECTED_PREFIX.productionUnits,
      )

      console.info(
        '[phase-g-canonical32-lbbd]',
        JSON.stringify({
          recipes: domain.recipes.length,
          assignmentEdges,
          productionEdges,
          exactEquivalenceGroups: groups.length,
          activeMasterGroups: master.activeGroupCount,
          masterVariables: master.variableCount,
          masterConstraints: master.constraintCount,
          witnessRecipeIdentities: witness.length,
          generatedColumns: 0,
          generatedCuts: 0,
          certificateSubproblems:
            diagnosis.combinedCertificate?.partitions.length ?? 3,
          fullDomainVerificationSolves: 1,
          masterIterations: 1,
          prefix: diagnosis.prefix,
          machineLowerBound: disposition.certificate.optimum,
          machineUpperBound: metrics.machineOperations,
          recipeKindsLowerBound:
            diagnosis.combinedCertificate?.recipeKindsOptimum ?? null,
          recipeKindsUpperBound: metrics.recipeKinds,
          verifiedAssignmentCount:
            disposition.certificate.verifiedAssignmentCount,
          certificateMs,
          masterAndWitnessMs,
          wallMs,
        }),
      )

      // The Phase G master/reconstruction layer itself must remain small; the
      // expensive work is allowed to remain in the exact certificate while we
      // measure the structural growth before Phase H / scaling-curve work.
      expect(masterAndWitnessMs).toBeLessThan(5_000)
    },
    600_000,
  )

  it('preserves fallback-required semantics for unavailable or limited certificate work', () => {
    expect(prototypeDisposition(null)).toEqual({ status: 'fallback-required' })
    expect(prototypeDisposition('limit')).toEqual({ status: 'fallback-required' })
  })
})
