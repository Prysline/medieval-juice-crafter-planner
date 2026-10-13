import { Model } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { customerVillageIsAvailable } from './availability'
import { optimizeBatchPlan } from './optimizer'
import { highsSolverAdapter } from './optimizerHighsSolver'
import {
  buildOptimizationModel,
  type BatchOptimizationModel,
  type EligibleOptimizationRecipe,
  type OptimizationRequest,
} from './optimizerModel'
import {
  profileOptimizerStructure,
  type OptimizerStructureProfile,
} from './optimizerPerformanceProfile'
import { buildRecipeCandidatePool } from './recipeCandidatePool'

interface NodeMemoryUsage {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

declare const process: {
  env: Record<string, string | undefined>
  memoryUsage(): NodeMemoryUsage
}

type WorkloadKind = 'canonical-slice' | 'p4' | 'synthetic-fallback'

interface ModelDimensions {
  serviceableCustomers: number
  unresolvedCustomers: number
  recipes: number
  assignmentEdges: number
  serviceGroups: number
  serviceCostGroups: number
  productionEdges: number
}

interface PrintedModelStats {
  lpChars: number
  lpLines: number
  constraints: number
  variables: number
  productionVariables: number
  assignmentVariables: number
  recipeUsageVariables: number
  operationVariables: number
  pairVariables: number
}

interface SolveProbeEvent {
  index: number
  label: string
  caller: string
  preSolveGapMs: number
  serializationProbeMs: number
  solveMs: number
  status: string
  objective: number | null
  model: PrintedModelStats | null
  memoryBefore: NodeMemoryUsage
  memoryAfter: NodeMemoryUsage
  serializationError?: string
  solveError?: string
}

interface SolveProbeContext {
  caseName: string
  workloadKind: WorkloadKind
  events: SolveProbeEvent[]
  certificatePartitionCursor: number
  fallbackStageCursor: number
  lastSolveEndedAt: number
}

const runProfile = process.env.OPTIMIZER_SCALABILITY_PROFILE === '1'
const requestedCase =
  process.env.OPTIMIZER_SCALABILITY_CASE ?? 'canonical-12'

function memorySnapshot(): NodeMemoryUsage {
  return process.memoryUsage()
}

function uniqueMatches(value: string, pattern: RegExp): Set<string> {
  return new Set(value.match(pattern) ?? [])
}

function countByPrefix(values: ReadonlySet<string>, prefix: string): number {
  return [...values].filter((value) => value.startsWith(prefix)).length
}

function printedModelStats(lp: string): PrintedModelStats {
  const variables = uniqueMatches(
    lp,
    /\b(?:x_group|x|y|z|op|pair|single|material_flow|inventory_shortfall|jar_type_switches)(?:_[A-Za-z0-9]+)*\b/g,
  )
  const subjectTo =
    lp.match(/Subject To([\s\S]*?)(?:\nBounds|\nGenerals|\nBinaries|\nEnd)/i)?.[1] ??
    ''
  const constraints =
    subjectTo.match(/^\s*[A-Za-z0-9_]+:/gm)?.length ?? 0

  return {
    lpChars: lp.length,
    lpLines: lp.split('\n').length,
    constraints,
    variables: variables.size,
    productionVariables:
      countByPrefix(variables, 'x_') +
      countByPrefix(variables, 'x_group_'),
    assignmentVariables: countByPrefix(variables, 'y_'),
    recipeUsageVariables: countByPrefix(variables, 'z_'),
    operationVariables: countByPrefix(variables, 'op_'),
    pairVariables:
      countByPrefix(variables, 'pair_') +
      countByPrefix(variables, 'single_'),
  }
}

function optimizerCaller(stack: string): string {
  return (
    stack
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.includes('optimizerHighsSolver')) ?? ''
  )
}

function classifyMainStage(
  context: SolveProbeContext,
  lp: string,
): string {
  const has = (value: string) => lp.includes(value)
  const hasOperations = /\bop_[0-9]+\b/.test(lp)
  const hasRecipeUsage = /\bz_[0-9]+\b/.test(lp)

  if (!has('fix_')) {
    return context.workloadKind === 'canonical-slice'
      ? 'minimum-waste'
      : 'minimum-cost'
  }

  if (
    has('fix_productionUnits_0') &&
    !has('fix_negativeAssignedIngredientCost_1')
  ) {
    return 'maximum-ingredient-cost'
  }

  if (
    has('fix_negativeAssignedIngredientCost_1') &&
    !has('fix_cost_2') &&
    !hasOperations
  ) {
    return 'production-cost-generic'
  }

  if (
    hasOperations &&
    (has('fix_cost_0') || has('fix_cost_2')) &&
    !has('fix_machineOperations_')
  ) {
    return 'machine-operations-generic'
  }

  if (hasRecipeUsage && has('fix_machineOperations_')) {
    return 'recipe-kinds'
  }

  if (has('fix_machineOperations_')) {
    if (context.workloadKind === 'synthetic-fallback') {
      return 'production-units-tiebreak'
    }
    if (has('fix_jarFillOperations_')) {
      return 'production-units-tiebreak'
    }
    if (context.workloadKind === 'p4') {
      return 'jar-fill-operations-generic'
    }
  }

  context.fallbackStageCursor += 1
  return `main-stage-${context.fallbackStageCursor}`
}

function classifySolve(
  context: SolveProbeContext,
  stack: string,
  lp: string,
): string {
  if (lp.includes('pair_cover_')) {
    return 'production-cost-pair-parity'
  }
  if (lp.includes('production_units_lower_bound')) {
    return 'machine-exact-production-units-probe'
  }
  if (stack.includes('tryMachineOperationCertificate')) {
    if (lp.includes('fixed_recipe_units_')) {
      return 'machine-certificate-fixed-x-verification'
    }
    const partitions = [
      'machine-certificate-juicing',
      'machine-certificate-seasoning',
      'machine-certificate-blending',
      'machine-certificate-finalizing',
    ]
    const label =
      partitions[context.certificatePartitionCursor] ??
      `machine-certificate-extra-${context.certificatePartitionCursor + 1}`
    context.certificatePartitionCursor += 1
    return label
  }
  if (stack.includes('tryJarSwitchCertificate')) {
    return 'jar-switch-certificate'
  }
  if (stack.includes('diagnoseInventoryOnly')) {
    return 'inventory-diagnostic'
  }
  return classifyMainStage(context, lp)
}

type ProbeSolution = {
  status: string
  objective?: number
}

type ProbeSolve = (
  this: Model,
  ...args: unknown[]
) => Promise<ProbeSolution>

function installSolveProbe(context: SolveProbeContext): () => void {
  const prototype = Model.prototype as unknown as {
    solve: ProbeSolve
  }
  const originalSolve = prototype.solve

  prototype.solve = async function (
    this: Model,
    ...args: unknown[]
  ): Promise<ProbeSolution> {
    const enteredAt = performance.now()
    const preSolveGapMs = enteredAt - context.lastSolveEndedAt
    const stack = new Error('optimizer scalability probe').stack ?? ''

    let lp = ''
    let serializationError: string | undefined
    const serializationStartedAt = performance.now()
    try {
      lp = this.print()
    } catch (error) {
      serializationError =
        error instanceof Error ? error.message : String(error)
    }
    const serializationProbeMs =
      performance.now() - serializationStartedAt
    const model = lp ? printedModelStats(lp) : null
    const label = classifySolve(context, stack, lp)
    const memoryBefore = memorySnapshot()
    const solveStartedAt = performance.now()

    try {
      const solution = await originalSolve.apply(this, args)
      const solveMs = performance.now() - solveStartedAt
      const memoryAfter = memorySnapshot()
      context.lastSolveEndedAt = performance.now()
      context.events.push({
        index: context.events.length + 1,
        label,
        caller: optimizerCaller(stack),
        preSolveGapMs,
        serializationProbeMs,
        solveMs,
        status: solution.status,
        objective:
          typeof solution.objective === 'number' &&
          Number.isFinite(solution.objective)
            ? solution.objective
            : null,
        model,
        memoryBefore,
        memoryAfter,
        ...(serializationError ? { serializationError } : {}),
      })
      return solution
    } catch (error) {
      const solveMs = performance.now() - solveStartedAt
      const memoryAfter = memorySnapshot()
      context.lastSolveEndedAt = performance.now()
      context.events.push({
        index: context.events.length + 1,
        label,
        caller: optimizerCaller(stack),
        preSolveGapMs,
        serializationProbeMs,
        solveMs,
        status: 'threw',
        objective: null,
        model,
        memoryBefore,
        memoryAfter,
        ...(serializationError ? { serializationError } : {}),
        solveError:
          error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  return () => {
    prototype.solve = originalSolve
  }
}

function summarizeDomain(
  domain: BatchOptimizationModel,
): ModelDimensions {
  const productionEdges = new Set<string>()
  const serviceGroups = new Set<string>()
  const serviceCostGroups = new Set<string>()
  let assignmentEdges = 0

  for (const recipe of domain.recipes) {
    assignmentEdges += recipe.eligibleCustomerIds.length
    const serviceKey = [...recipe.eligibleCustomerIds].sort().join('\u001e')
    serviceGroups.add(serviceKey)
    serviceCostGroups.add(
      `${serviceKey}\u001d${recipe.juiceUnitIngredientCost}`,
    )
    for (const edge of recipe.productionPath.edges) {
      productionEdges.add(edge.key)
    }
  }

  return {
    serviceableCustomers: domain.serviceableCustomerIds.length,
    unresolvedCustomers: domain.unresolvedCustomerIds.length,
    recipes: domain.recipes.length,
    assignmentEdges,
    serviceGroups: serviceGroups.size,
    serviceCostGroups: serviceCostGroups.size,
    productionEdges: productionEdges.size,
  }
}

function errorSummary(error: unknown): {
  name: string
  message: string
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'unknown', message: String(error) }
}

async function runWithProbe<T>(
  context: SolveProbeContext,
  operation: () => Promise<T>,
): Promise<{
  outcome: 'success' | 'error'
  result?: T
  error?: { name: string; message: string }
  wallMs: number
  serializationProbeMs: number
  adjustedWallMs: number
  memoryBefore: NodeMemoryUsage
  memoryAfter: NodeMemoryUsage
}> {
  const memoryBefore = memorySnapshot()
  const startedAt = performance.now()
  context.lastSolveEndedAt = startedAt
  const restore = installSolveProbe(context)

  try {
    const result = await operation()
    const wallMs = performance.now() - startedAt
    const serializationProbeMs = context.events.reduce(
      (total, event) => total + event.serializationProbeMs,
      0,
    )
    return {
      outcome: 'success',
      result,
      wallMs,
      serializationProbeMs,
      adjustedWallMs: Math.max(0, wallMs - serializationProbeMs),
      memoryBefore,
      memoryAfter: memorySnapshot(),
    }
  } catch (error) {
    const wallMs = performance.now() - startedAt
    const serializationProbeMs = context.events.reduce(
      (total, event) => total + event.serializationProbeMs,
      0,
    )
    return {
      outcome: 'error',
      error: errorSummary(error),
      wallMs,
      serializationProbeMs,
      adjustedWallMs: Math.max(0, wallMs - serializationProbeMs),
      memoryBefore,
      memoryAfter: memorySnapshot(),
    }
  } finally {
    restore()
  }
}

function emitProfile(
  caseName: string,
  payload: Record<string, unknown>,
  events: readonly SolveProbeEvent[],
): void {
  for (const event of events) {
    console.info(
      '[optimizer-scalability-stage]',
      JSON.stringify({ caseName, ...event }),
    )
  }
  console.info(
    '[optimizer-scalability-summary]',
    JSON.stringify({ caseName, ...payload }),
  )
}

function currentWorldRequest(
  requestedCustomerCount: number,
): OptimizationRequest {
  const currentProgress = 'liquid-blender-unlocked'
  const availableCustomerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)
  const customerIds = availableCustomerIds.slice(
    0,
    requestedCustomerCount,
  )

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

function p4Request(): OptimizationRequest {
  const currentProgress = 'juice-blender-unlocked'
  const customerIds = canonicalCustomers
    .filter((customer) =>
      customerVillageIsAvailable(customer, currentProgress),
    )
    .map((customer) => customer.id)

  return {
    customerIds,
    currentProgress,
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 0,
    },
    formalCustomerIds: customerIds,
    candidatePolicy: 'allow-unambiguous-computed',
    objective: 'minimum-cost',
    priorities: [
      'minimum-cost',
      'minimum-machine-operations',
      'minimum-jar-fill-operations',
    ],
    availableJuiceJarCount: 2,
  }
}

function fallbackRecipe(
  id: string,
  kind: 'juicing' | 'finalizing',
): EligibleOptimizationRecipe {
  return {
    candidate: {
      id,
      name: id,
      source: 'observed',
      unlockedAt: 'opening',
      salePrice: 10,
      ingredients: ['檸檬'],
      effects: [{ name: '酸味', value: 4 }],
      equipment: [],
    },
    juiceUnitIngredientCost: 1,
    eligibleCustomerIds: ['a'],
    productionPath: {
      ingredientIds: ['lemon'],
      edges: [
        kind === 'juicing'
          ? {
              key: `juice:${id}`,
              kind: 'juicing',
              equipment: '柑橘榨汁機',
              fromIngredientIds: [],
              toIngredientIds: ['lemon'],
            }
          : {
              key: `finish:${id}`,
              kind: 'finalizing',
              equipment: '果汁成品台',
              fromIngredientIds: ['lemon'],
              toIngredientIds: ['lemon'],
            },
      ],
    },
  }
}

function syntheticFallbackDomain(
  recipeCount: number,
): BatchOptimizationModel {
  const request: OptimizationRequest = {
    customerIds: ['a'],
    currentProgress: 'seasoner-unlocked',
    suppliedCustomerIds: [],
    satisfactionByVillage: {
      'east-harbor': 999,
      'tranquil-fountain': 999,
      'ibex-statue': 0,
    },
    formalCustomerIds: ['a'],
    candidatePolicy: 'observed-only',
    objective: 'minimum-cost',
    priorities: ['minimum-cost', 'minimum-machine-operations'],
    availableJuiceJarCount: 1,
  }

  return {
    request,
    serviceableCustomerIds: ['a'],
    unresolvedCustomerIds: [],
    excludedSuppliedCustomerIds: [],
    recipes: Array.from({ length: recipeCount }, (_, index) =>
      fallbackRecipe(
        `fallback-${index}`,
        index % 2 === 0 ? 'juicing' : 'finalizing',
      ),
    ),
  }
}

async function runCanonicalCase(
  caseName: string,
  request: OptimizationRequest,
  workloadKind: 'canonical-slice' | 'p4',
): Promise<void> {
  const poolStartedAt = performance.now()
  const candidatePool = buildRecipeCandidatePool(
    request.currentProgress,
  )
  const candidatePoolBuildMs = performance.now() - poolStartedAt
  const source = {
    customers: canonicalCustomers,
    candidatePool,
  }
  const structure: OptimizerStructureProfile =
    profileOptimizerStructure(request, source)
  const domain = buildOptimizationModel(request, source)
  const dimensions = summarizeDomain(domain)
  const context: SolveProbeContext = {
    caseName,
    workloadKind,
    events: [],
    certificatePartitionCursor: 0,
    fallbackStageCursor: 0,
    lastSolveEndedAt: 0,
  }
  const pipeline = await runWithProbe(
    context,
    () => optimizeBatchPlan(request, { source }),
  )

  emitProfile(
    caseName,
    {
      workloadKind,
      provenance:
        workloadKind === 'p4'
          ? 'canonical-regression-fixture'
          : 'canonical-current-world-customer-slice',
      requestedCustomers: request.customerIds.length,
      candidatePoolBuildMs,
      structure,
      dimensions,
      pipeline: {
        outcome: pipeline.outcome,
        wallMs: pipeline.wallMs,
        serializationProbeMs: pipeline.serializationProbeMs,
        adjustedWallMs: pipeline.adjustedWallMs,
        memoryBefore: pipeline.memoryBefore,
        memoryAfter: pipeline.memoryAfter,
        ...(pipeline.error ? { error: pipeline.error } : {}),
      },
    },
    context.events,
  )

  expect(dimensions.recipes).toBeGreaterThan(0)
  expect(dimensions.assignmentEdges).toBeGreaterThan(0)
  expect(context.events.length).toBeGreaterThan(0)
}

async function runSyntheticCase(
  caseName: string,
  recipeCount: number,
): Promise<void> {
  const domain = syntheticFallbackDomain(recipeCount)
  const dimensions = summarizeDomain(domain)
  const context: SolveProbeContext = {
    caseName,
    workloadKind: 'synthetic-fallback',
    events: [],
    certificatePartitionCursor: 0,
    fallbackStageCursor: 0,
    lastSolveEndedAt: 0,
  }
  const pipeline = await runWithProbe(
    context,
    () =>
      highsSolverAdapter.solve(
        domain,
        domain.request.priorities ?? [],
      ),
  )

  emitProfile(
    caseName,
    {
      workloadKind: 'synthetic-fallback',
      provenance: 'synthetic-recipe-identity-scaling-fixture',
      requestedCustomers: 1,
      dimensions,
      pipeline: {
        outcome: pipeline.outcome,
        wallMs: pipeline.wallMs,
        serializationProbeMs: pipeline.serializationProbeMs,
        adjustedWallMs: pipeline.adjustedWallMs,
        memoryBefore: pipeline.memoryBefore,
        memoryAfter: pipeline.memoryAfter,
        ...(pipeline.error ? { error: pipeline.error } : {}),
      },
    },
    context.events,
  )

  expect(dimensions.recipes).toBe(recipeCount)
  expect(dimensions.assignmentEdges).toBe(recipeCount)
  expect(context.events.length).toBeGreaterThan(0)
}

describe.skipIf(!runProfile)(
  'optimizer scalability diagnosis profile',
  () => {
    it(
      `profiles ${requestedCase}`,
      async () => {
        const canonicalMatch =
          /^canonical-(\d+)$/.exec(requestedCase)
        if (canonicalMatch) {
          await runCanonicalCase(
            requestedCase,
            currentWorldRequest(Number(canonicalMatch[1])),
            'canonical-slice',
          )
          return
        }

        if (requestedCase === 'p4') {
          await runCanonicalCase(
            requestedCase,
            p4Request(),
            'p4',
          )
          return
        }

        const syntheticMatch =
          /^synthetic-(\d+)$/.exec(requestedCase)
        if (syntheticMatch) {
          await runSyntheticCase(
            requestedCase,
            Number(syntheticMatch[1]),
          )
          return
        }

        throw new Error(
          `Unknown optimizer scalability case: ${requestedCase}`,
        )
      },
      25 * 60 * 1000,
    )
  },
)
