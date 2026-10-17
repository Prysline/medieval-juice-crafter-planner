import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'
import {
  finalizingEdgesAreRecipeIdentityUnique,
  machineOperationBreakdownForSelection,
  type RecipeUnitSelection,
} from './optimizerCertificates'
import * as highsSolverModule from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import type { ProductionStepKind } from './productionPlan'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

declare const process: {
  env: Record<string, string | undefined>
  memoryUsage(): { rss: number }
}

const enabled = process.env.OPTIMIZER_PHASE_H_CANONICAL69_QUOTIENT === '1'
const EXPECTED_PREFIX = {
  productionUnits: 34,
  assignedIngredientCost: 3751,
  productionCost: 1897,
} as const
const EXPECTED_MACHINE = {
  throughSeasoning: 37,
  blending: 36,
  finalizing: 29,
  total: 102,
} as const
const UNUSED_SERVING_COST =
  EXPECTED_PREFIX.productionCost * 2 - EXPECTED_PREFIX.assignedIngredientCost

type IntVariable = ReturnType<Model['intVar']>
type BoolVariable = ReturnType<Model['boolVar']>
type NumVariable = ReturnType<Model['numVar']>
type HighsSolution = Awaited<ReturnType<Model['solve']>>
type ObjectiveFix = {
  objective:
    | 'productionUnits'
    | 'negativeAssignedIngredientCost'
    | 'cost'
  value: number
}
interface HarnessBuilt {
  model: Model
  xByRecipeId: Map<string, IntVariable>
  yByCustomerRecipe: Map<string, BoolVariable>
  operationByEdgeKey: Map<string, IntVariable>
}
type BuildHighsStage = (
  domain: BatchOptimizationModel,
  objective: 'machineOperations',
  fixes: ObjectiveFix[],
  options?: Record<string, unknown>,
) => HarnessBuilt

type EdgeMultiplicity = {
  key: string
  kind: ProductionStepKind
  multiplicity: number
}

type QuotientGroup = {
  key: string
  serviceCostKey: string
  ingredientCost: number
  eligibleCustomerIds: string[]
  recipeIds: string[]
  unitCap: number
  normalUnitCap: number
  nonFinalizingEdges: EdgeMultiplicity[]
}

type QuotientVariables = {
  units: IntVariable
  normalIdentities: IntVariable
  sixPlusIdentities: IntVariable | null
}

function request69(): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
    .slice(0, 69)
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

function buildStage(): BuildHighsStage {
  const result = (
    highsSolverModule as unknown as { buildHighsStage?: BuildHighsStage }
  ).buildHighsStage
  if (!result) throw new Error('Phase H quotient diagnosis seam unavailable')
  return result
}

function prefixFixes(): ObjectiveFix[] {
  return [
    { objective: 'productionUnits', value: EXPECTED_PREFIX.productionUnits },
    {
      objective: 'negativeAssignedIngredientCost',
      value: -EXPECTED_PREFIX.assignedIngredientCost,
    },
    { objective: 'cost', value: EXPECTED_PREFIX.productionCost },
  ]
}

function serviceCostKey(recipe: EligibleOptimizationRecipe) {
  return `${[...recipe.eligibleCustomerIds].sort().join('\u001e')}\u001d${recipe.juiceUnitIngredientCost}`
}

function perIdentityUnitCap(
  recipe: EligibleOptimizationRecipe,
) {
  const customerCap = Math.max(
    1,
    Math.ceil(recipe.eligibleCustomerIds.length / 2),
  )
  const costCap =
    recipe.juiceUnitIngredientCost > 0
      ? Math.floor(
          EXPECTED_PREFIX.productionCost /
            recipe.juiceUnitIngredientCost,
        )
      : EXPECTED_PREFIX.productionUnits
  const declaredCap =
    recipe.maxProductionUnits === undefined
      ? EXPECTED_PREFIX.productionUnits
      : Math.max(0, Math.floor(recipe.maxProductionUnits))
  return Math.max(
    0,
    Math.min(
      EXPECTED_PREFIX.productionUnits,
      customerCap,
      costCap,
      declaredCap,
      7,
    ),
  )
}

function nonFinalizingSignature(
  recipe: EligibleOptimizationRecipe,
): EdgeMultiplicity[] {
  const byKey = new Map<
    string,
    { kind: ProductionStepKind; multiplicity: number }
  >()
  for (const edge of recipe.productionPath.edges) {
    if (edge.kind === 'finalizing') continue
    const current = byKey.get(edge.key)
    if (current && current.kind !== edge.kind) {
      throw new Error(`Phase H quotient edge kind drift for ${edge.key}`)
    }
    byKey.set(edge.key, {
      kind: edge.kind,
      multiplicity: (current?.multiplicity ?? 0) + 1,
    })
  }
  return [...byKey.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function quotientGroups(
  domain: BatchOptimizationModel,
): QuotientGroup[] {
  const groups = new Map<string, QuotientGroup>()
  for (const recipe of domain.recipes) {
    const unitCap = perIdentityUnitCap(recipe)
    if (unitCap <= 0) continue
    const edges = nonFinalizingSignature(recipe)
    const sKey = serviceCostKey(recipe)
    const key = JSON.stringify({
      serviceCostKey: sKey,
      unitCap,
      edges,
    })
    const current = groups.get(key)
    if (current) {
      current.recipeIds.push(recipe.candidate.id)
    } else {
      groups.set(key, {
        key,
        serviceCostKey: sKey,
        ingredientCost: recipe.juiceUnitIngredientCost,
        eligibleCustomerIds: [...recipe.eligibleCustomerIds].sort(),
        recipeIds: [recipe.candidate.id],
        unitCap,
        normalUnitCap: Math.min(5, unitCap),
        nonFinalizingEdges: edges,
      })
    }
  }
  return [...groups.values()]
}

function disposition(status: string) {
  if (status === 'optimal') return 'witness-ready' as const
  if (status === 'infeasible') return 'exact-infeasible-at-102' as const
  return 'fallback-required' as const
}

function requiredValue(
  solution: HighsSolution,
  variable: IntVariable | BoolVariable | NumVariable,
  label: string,
) {
  const value = solution.getValue(variable)
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`Missing Phase H quotient value for ${label}`)
  }
  return value
}

function reconstructGroupRecipeUnits(
  group: QuotientGroup,
  units: number,
  normalIdentities: number,
  sixPlusIdentities: number,
): RecipeUnitSelection[] {
  const active = normalIdentities + sixPlusIdentities
  if (active > group.recipeIds.length) {
    throw new Error(`Phase H quotient identity overflow for ${group.key}`)
  }
  const recipeIds = group.recipeIds.slice(0, active)
  const values = [
    ...Array.from({ length: sixPlusIdentities }, () => 6),
    ...Array.from({ length: normalIdentities }, () => 1),
  ]
  let remaining =
    units - values.reduce((total, value) => total + value, 0)

  for (
    let index = 0;
    index < sixPlusIdentities && remaining > 0;
    index += 1
  ) {
    const room = group.unitCap - values[index]
    const add = Math.min(room, remaining)
    values[index] += add
    remaining -= add
  }
  for (
    let index = sixPlusIdentities;
    index < values.length && remaining > 0;
    index += 1
  ) {
    const room = group.normalUnitCap - values[index]
    const add = Math.min(room, remaining)
    values[index] += add
    remaining -= add
  }
  if (remaining !== 0) {
    throw new Error(`Phase H quotient reconstruction residual ${remaining}`)
  }
  return recipeIds.map((recipeId, index) => ({
    recipeId,
    units: values[index],
  }))
}

async function fullVerify(
  domain: BatchOptimizationModel,
  witness: readonly RecipeUnitSelection[],
) {
  const built = buildStage()(
    domain,
    'machineOperations',
    prefixFixes(),
    {
      fixedRecipeUnits: new Map(
        witness.map((selection) => [selection.recipeId, selection.units]),
      ),
      tightenRecipeBoundsFromMinimumCostFix: true,
      tightenOperationBoundsFromRecipeBounds: true,
    },
  )
  const startedAt = performance.now()
  const solution = await built.model.solve()
  const solveMs = performance.now() - startedAt
  if (solution.status !== 'optimal') {
    throw new Error(
      `Phase H quotient fixed-x verification status: ${solution.status}`,
    )
  }
  expect(Math.round(solution.objective ?? Number.NaN)).toBe(
    EXPECTED_MACHINE.total,
  )

  const recipeById = new Map(
    domain.recipes.map((recipe) => [recipe.candidate.id, recipe]),
  )
  const assignmentByCustomer = new Map<string, string>()
  for (const [key, variable] of built.yByCustomerRecipe) {
    if (requiredValue(solution, variable, key) <= 0.5) continue
    const separator = key.indexOf('\u001f')
    const customerId = key.slice(0, separator)
    const recipeId = key.slice(separator + 1)
    if (assignmentByCustomer.has(customerId)) {
      throw new Error(
        `Duplicate Phase H quotient assignment for ${customerId}`,
      )
    }
    assignmentByCustomer.set(customerId, recipeId)
  }
  expect(assignmentByCustomer.size).toBe(
    domain.serviceableCustomerIds.length,
  )

  let assignedIngredientCost = 0
  for (const customerId of domain.serviceableCustomerIds) {
    const recipeId = assignmentByCustomer.get(customerId)
    if (!recipeId) {
      throw new Error(
        `Missing Phase H quotient assignment for ${customerId}`,
      )
    }
    const recipe = recipeById.get(recipeId)
    if (!recipe) {
      throw new Error(`Unknown Phase H quotient recipe ${recipeId}`)
    }
    expect(recipe.eligibleCustomerIds).toContain(customerId)
    assignedIngredientCost += recipe.juiceUnitIngredientCost
  }

  const productionUnits = witness.reduce(
    (total, entry) => total + entry.units,
    0,
  )
  const productionCost = witness.reduce((total, entry) => {
    const recipe = recipeById.get(entry.recipeId)
    if (!recipe) {
      throw new Error(
        `Unknown Phase H quotient witness ${entry.recipeId}`,
      )
    }
    return total + entry.units * recipe.juiceUnitIngredientCost
  }, 0)
  const machine = machineOperationBreakdownForSelection(
    domain,
    [...witness],
  )
  const assignmentRecipeKinds = new Set(
    assignmentByCustomer.values(),
  ).size

  expect(productionUnits).toBe(EXPECTED_PREFIX.productionUnits)
  expect(productionCost).toBe(EXPECTED_PREFIX.productionCost)
  expect(assignedIngredientCost).toBe(
    EXPECTED_PREFIX.assignedIngredientCost,
  )
  expect(machine.juicing + machine.seasoning).toBe(
    EXPECTED_MACHINE.throughSeasoning,
  )
  expect(machine.blending).toBe(EXPECTED_MACHINE.blending)
  expect(machine.finalizing).toBe(EXPECTED_MACHINE.finalizing)
  expect(machine.total).toBe(EXPECTED_MACHINE.total)
  expect(assignmentRecipeKinds).toBe(witness.length)

  return {
    solveMs,
    verifiedAssignmentCount: assignmentByCustomer.size,
    assignmentRecipeKinds,
    machine,
  }
}

describe.skipIf(!enabled)(
  'Phase H canonical-69 exact machine quotient prototype',
  () => {
    it(
      'closes 102 through a full-identity-equivalent quotient or proves it infeasible',
      async () => {
        const totalStartedAt = performance.now()
        const request = request69()
        const candidateStartedAt = performance.now()
        const candidatePool = buildRecipeCandidatePool(
          request.currentProgress,
        )
        const candidatePoolMs =
          performance.now() - candidateStartedAt
        const domainStartedAt = performance.now()
        const domain = buildOptimizationModel(request, {
          customers: canonicalCustomers,
          candidatePool,
        })
        const domainBuildMs = performance.now() - domainStartedAt

        expect(domain.serviceableCustomerIds.length).toBe(67)
        expect(domain.unresolvedCustomerIds.length).toBe(2)
        expect(UNUSED_SERVING_COST).toBe(43)
        expect(finalizingEdgesAreRecipeIdentityUnique(domain)).toBe(true)
        expect(
          domain.recipes.every(
            (recipe) => (recipe.initialFinishedServings ?? 0) === 0,
          ),
        ).toBe(true)

        const groups = quotientGroups(domain)
        const model = new Model()
        const varsByGroup = new Map<string, QuotientVariables>()
        const serviceCostGroups = new Map<
          string,
          {
            ingredientCost: number
            eligibleCustomerIds: string[]
            quotientGroups: QuotientGroup[]
          }
        >()

        for (const [groupIndex, group] of groups.entries()) {
          const units = model.intVar(
            0,
            Math.min(
              EXPECTED_PREFIX.productionUnits,
              group.recipeIds.length * group.unitCap,
            ),
            `q_x_${groupIndex}`,
          )
          const normalIdentities = model.intVar(
            0,
            group.recipeIds.length,
            `q_normal_${groupIndex}`,
          )
          const sixPlusIdentities =
            group.unitCap >= 6
              ? model.intVar(
                  0,
                  group.recipeIds.length,
                  `q_six_${groupIndex}`,
                )
              : null

          if (sixPlusIdentities) {
            model.addConstraint(
              sum(normalIdentities, sixPlusIdentities).leq(
                group.recipeIds.length,
              ),
              `q_identity_count_${groupIndex}`,
            )
            model.addConstraint(
              sum(
                normalIdentities,
                sixPlusIdentities.times(6),
              )
                .minus(units)
                .leq(0),
              `q_units_min_${groupIndex}`,
            )
            model.addConstraint(
              units
                .minus(
                  normalIdentities.times(group.normalUnitCap),
                )
                .minus(
                  sixPlusIdentities.times(group.unitCap),
                )
                .leq(0),
              `q_units_max_${groupIndex}`,
            )
          } else {
            model.addConstraint(
              normalIdentities.leq(group.recipeIds.length),
              `q_identity_count_${groupIndex}`,
            )
            model.addConstraint(
              normalIdentities.minus(units).leq(0),
              `q_units_min_${groupIndex}`,
            )
            model.addConstraint(
              units
                .minus(
                  normalIdentities.times(group.normalUnitCap),
                )
                .leq(0),
              `q_units_max_${groupIndex}`,
            )
          }

          varsByGroup.set(group.key, {
            units,
            normalIdentities,
            sixPlusIdentities,
          })

          const current = serviceCostGroups.get(
            group.serviceCostKey,
          )
          if (current) current.quotientGroups.push(group)
          else {
            serviceCostGroups.set(group.serviceCostKey, {
              ingredientCost: group.ingredientCost,
              eligibleCustomerIds: group.eligibleCustomerIds,
              quotientGroups: [group],
            })
          }
        }

        model.addConstraint(
          sum(
            ...[...varsByGroup.values()].map(
              (entry) => entry.units,
            ),
          ).eq(EXPECTED_PREFIX.productionUnits),
          'q_production_units',
        )
        model.addConstraint(
          sum(
            ...groups.map((group) =>
              varsByGroup
                .get(group.key)!
                .units.times(group.ingredientCost),
            ),
          ).eq(EXPECTED_PREFIX.productionCost),
          'q_production_cost',
        )

        const yByCustomerGroup = new Map<string, NumVariable>()
        domain.serviceableCustomerIds.forEach(
          (customerId, customerIndex) => {
            const variables: NumVariable[] = []
            let groupIndex = 0
            for (const [key, group] of serviceCostGroups) {
              if (!group.eligibleCustomerIds.includes(customerId)) {
                groupIndex += 1
                continue
              }
              const y = model.numVar(
                0,
                1,
                `q_y_${customerIndex}_${groupIndex}`,
              )
              yByCustomerGroup.set(
                `${customerId}\u001f${key}`,
                y,
              )
              variables.push(y)
              groupIndex += 1
            }
            model.addConstraint(
              sum(...variables).eq(1),
              `q_customer_${customerIndex}`,
            )
          },
        )

        const dummyAssignments: NumVariable[] = []
        let serviceGroupIndex = 0
        for (const [key, group] of serviceCostGroups) {
          const assignments = group.eligibleCustomerIds.flatMap(
            (customerId) => {
              const variable = yByCustomerGroup.get(
                `${customerId}\u001f${key}`,
              )
              return variable ? [variable] : []
            },
          )
          const dummy =
            group.ingredientCost === UNUSED_SERVING_COST
              ? model.numVar(
                  0,
                  1,
                  `q_unused_${serviceGroupIndex}`,
                )
              : null
          if (dummy) dummyAssignments.push(dummy)
          const capacity = group.quotientGroups.map(
            (quotientGroup) =>
              varsByGroup
                .get(quotientGroup.key)!
                .units.times(2),
          )
          model.addConstraint(
            sum(...assignments, ...(dummy ? [dummy] : []))
              .minus(sum(...capacity))
              .eq(0),
            `q_group_flow_${serviceGroupIndex}`,
          )
          serviceGroupIndex += 1
        }
        expect(dummyAssignments.length).toBeGreaterThan(0)
        model.addConstraint(
          sum(...dummyAssignments).eq(1),
          'q_unused_total',
        )
        model.addConstraint(
          sum(
            ...[...yByCustomerGroup.entries()].map(
              ([key, variable]) => {
                const groupKey = key.slice(
                  key.indexOf('\u001f') + 1,
                )
                return variable.times(
                  serviceCostGroups.get(groupKey)!.ingredientCost,
                )
              },
            ),
          ).eq(EXPECTED_PREFIX.assignedIngredientCost),
          'q_assigned_cost',
        )

        const quantityTermsByEdge = new Map<
          string,
          {
            kind: ProductionStepKind
            terms: ReturnType<IntVariable['times']>[]
            maxMultiplicity: number
          }
        >()
        for (const group of groups) {
          const units = varsByGroup.get(group.key)!.units
          for (const edge of group.nonFinalizingEdges) {
            const current = quantityTermsByEdge.get(edge.key)
            const term = units.times(edge.multiplicity)
            if (current) {
              if (current.kind !== edge.kind) {
                throw new Error(
                  `Phase H quotient edge kind drift ${edge.key}`,
                )
              }
              current.terms.push(term)
              current.maxMultiplicity = Math.max(
                current.maxMultiplicity,
                edge.multiplicity,
              )
            } else {
              quantityTermsByEdge.set(edge.key, {
                kind: edge.kind,
                terms: [term],
                maxMultiplicity: edge.multiplicity,
              })
            }
          }
        }

        const throughSeasoningOps: IntVariable[] = []
        const blendingOps: IntVariable[] = []
        let edgeIndex = 0
        for (const [edgeKey, edge] of quantityTermsByEdge) {
          const maxQuantity =
            EXPECTED_PREFIX.productionUnits * edge.maxMultiplicity
          const operation = model.intVar(
            0,
            Math.ceil(
              maxQuantity / PROCESSING_STACK_CAPACITY,
            ),
            `q_op_${edgeIndex}`,
          )
          const quantity = sum(...edge.terms)
          model.addConstraint(
            quantity
              .minus(
                operation.times(PROCESSING_STACK_CAPACITY),
              )
              .leq(0),
            `q_op_capacity_${edgeIndex}`,
          )
          model.addConstraint(
            operation
              .times(PROCESSING_STACK_CAPACITY)
              .minus(quantity)
              .leq(PROCESSING_STACK_CAPACITY - 1),
            `q_op_exact_ceil_${edgeIndex}`,
          )
          if (
            edge.kind === 'juicing' ||
            edge.kind === 'seasoning'
          ) {
            throughSeasoningOps.push(operation)
          } else if (edge.kind === 'blending') {
            blendingOps.push(operation)
          } else {
            throw new Error(
              `Unexpected Phase H quotient edge kind ${edge.kind}/${edgeKey}`,
            )
          }
          edgeIndex += 1
        }
        model.addConstraint(
          sum(...throughSeasoningOps).eq(
            EXPECTED_MACHINE.throughSeasoning,
          ),
          'q_through_seasoning',
        )
        model.addConstraint(
          sum(...blendingOps).eq(EXPECTED_MACHINE.blending),
          'q_blending',
        )

        const finalizingOps = groups.map((group) => {
          const variables = varsByGroup.get(group.key)!
          return variables.sixPlusIdentities
            ? sum(
                variables.normalIdentities,
                variables.sixPlusIdentities.times(2),
              )
            : variables.normalIdentities.times(1)
        })
        model.addConstraint(
          sum(...finalizingOps).eq(EXPECTED_MACHINE.finalizing),
          'q_finalizing',
        )
        const positiveKinds = sum(
          ...groups.map((group) => {
            const variables = varsByGroup.get(group.key)!
            return variables.sixPlusIdentities
              ? sum(
                  variables.normalIdentities,
                  variables.sixPlusIdentities,
                )
              : variables.normalIdentities.times(1)
          }),
        )
        model.minimize(positiveKinds)

        console.info(
          '[phase-h-canonical69-quotient-model]',
          JSON.stringify({
            recipes: domain.recipes.length,
            quotientGroups: groups.length,
            serviceCostGroups: serviceCostGroups.size,
            aggregateUnitIntegerVars: varsByGroup.size,
            identityCountIntegerVars:
              groups.length +
              groups.filter((group) => group.unitCap >= 6).length,
            continuousAssignmentVars:
              yByCustomerGroup.size + dummyAssignments.length,
            nonFinalizingOperationIntegerVars:
              quantityTermsByEdge.size,
            throughSeasoningEdges: throughSeasoningOps.length,
            blendingEdges: blendingOps.length,
            unusedServingCost: UNUSED_SERVING_COST,
            candidatePoolMs,
            domainBuildMs,
            rssMb: process.memoryUsage().rss / 1024 / 1024,
          }),
        )

        const solveStartedAt = performance.now()
        const solution = await model.solve()
        const solveMs = performance.now() - solveStartedAt
        const state = disposition(solution.status)
        console.info(
          '[phase-h-canonical69-quotient-result]',
          JSON.stringify({
            status: solution.status,
            disposition: state,
            objective:
              typeof solution.objective === 'number'
                ? solution.objective
                : null,
            solveMs,
            rssMb: process.memoryUsage().rss / 1024 / 1024,
          }),
        )

        expect(
          state,
          state === 'exact-infeasible-at-102'
            ? 'Exact quotient proves no original-domain 102 witness exists'
            : 'Limit/unknown remains performance evidence only',
        ).toBe('witness-ready')
        if (state !== 'witness-ready') return

        const witness: RecipeUnitSelection[] = []
        for (const group of groups) {
          const variables = varsByGroup.get(group.key)!
          const units = Math.round(
            requiredValue(
              solution,
              variables.units,
              `${group.key}/units`,
            ),
          )
          const normal = Math.round(
            requiredValue(
              solution,
              variables.normalIdentities,
              `${group.key}/normal`,
            ),
          )
          const sixPlus = variables.sixPlusIdentities
            ? Math.round(
                requiredValue(
                  solution,
                  variables.sixPlusIdentities,
                  `${group.key}/six`,
                ),
              )
            : 0
          if (units === 0) {
            expect(normal + sixPlus).toBe(0)
            continue
          }
          witness.push(
            ...reconstructGroupRecipeUnits(
              group,
              units,
              normal,
              sixPlus,
            ),
          )
        }

        const quotientKinds = Math.round(
          solution.objective ?? Number.NaN,
        )
        expect(witness).toHaveLength(quotientKinds)
        expect(quotientKinds).toBeGreaterThanOrEqual(28)
        expect(quotientKinds).toBeLessThanOrEqual(29)

        const verification = await fullVerify(domain, witness)
        expect(verification.assignmentRecipeKinds).toBe(
          quotientKinds,
        )
        expect(verification.machine.total).toBe(
          EXPECTED_MACHINE.total,
        )

        console.info(
          '[phase-h-canonical69-quotient-closure]',
          JSON.stringify({
            prefix: EXPECTED_PREFIX,
            machineLowerBound: EXPECTED_MACHINE.total,
            machineUpperBound: verification.machine.total,
            machinePartitions: EXPECTED_MACHINE,
            recipeKindsLowerBound: 28,
            recipeKindsOptimum: quotientKinds,
            recipeKindsUpperBound:
              verification.assignmentRecipeKinds,
            witnessRecipeIdentities: witness.length,
            verifiedAssignmentCount:
              verification.verifiedAssignmentCount,
            quotientGroups: groups.length,
            serviceCostGroups: serviceCostGroups.size,
            nonFinalizingOperationIntegerVars:
              quantityTermsByEdge.size,
            solveMs,
            fixedXVerificationMs: verification.solveMs,
            totalMs: performance.now() - totalStartedAt,
            rssMb: process.memoryUsage().rss / 1024 / 1024,
          }),
        )
      },
      1_800_000,
    )

    it('keeps non-exact solver statuses out of infeasibility claims', () => {
      expect(disposition('time_limit')).toBe('fallback-required')
      expect(disposition('unknown')).toBe('fallback-required')
      expect(disposition('optimal')).toBe('witness-ready')
      expect(disposition('infeasible')).toBe(
        'exact-infeasible-at-102',
      )
    })
  },
)
