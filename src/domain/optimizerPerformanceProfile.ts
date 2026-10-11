import { customers as canonicalCustomers } from '../data/customers'
import type { Customer } from '../types'
import {
  buildOptimizationModel,
  type OptimizationRequest,
  type OptimizationSource,
} from './optimizerModel'
import {
  buildRecipeCandidatePool,
  type RecipeCandidatePool,
} from './recipeCandidatePool'
import { searchRecipeCandidatesForCustomer } from './recipeSearch'

export interface OptimizerSearchProfile {
  requestedCustomerCount: number
  searchedCustomerCount: number
  rawCandidateCount: number
  exploredLayerCount: number
  truncatedCustomerCount: number
  guaranteedFullMatchCustomerCount: number
}

export interface OptimizerModelProfile {
  serviceableCustomerCount: number
  unresolvedCustomerCount: number
  recipeCount: number
  assignmentEdgeCount: number
  minimumEligibleRecipesPerCustomer: number
  maximumEligibleRecipesPerCustomer: number
  averageEligibleRecipesPerCustomer: number
}

export interface OptimizerStructureProfile {
  candidatePolicy: OptimizationRequest['candidatePolicy']
  objective: OptimizationRequest['objective']
  candidatePoolEntryCount: number
  generatedLayerCount: number
  generatedCandidateReferenceCount: number
  generatedSequenceCount: number
  truncatedGeneratedLayerCount: number
  search: OptimizerSearchProfile
  model: OptimizerModelProfile
  timingsMs: {
    candidatePool: number
    rawSearch: number
    modelBuild: number
    total: number
  }
}

export interface OptimizerPolicyPairProfile {
  trusted: OptimizerStructureProfile
  computed: OptimizerStructureProfile
  deltas: {
    rawCandidateCount: number
    recipeCount: number
    assignmentEdgeCount: number
    modelBuildMs: number
  }
}

function elapsedMs(startedAt: number): number {
  return performance.now() - startedAt
}

function profileRawSearch(
  request: OptimizationRequest,
  customers: readonly Customer[],
  pool: RecipeCandidatePool,
): OptimizerSearchProfile {
  const supplied = new Set(request.suppliedCustomerIds)
  const customerById = new Map(
    customers.map((customer) => [customer.id, customer]),
  )
  let searchedCustomerCount = 0
  let rawCandidateCount = 0
  let exploredLayerCount = 0
  let truncatedCustomerCount = 0
  let guaranteedFullMatchCustomerCount = 0

  for (const customerId of new Set(request.customerIds)) {
    if (supplied.has(customerId)) continue
    const customer = customerById.get(customerId)
    if (!customer) continue

    const result = searchRecipeCandidatesForCustomer(
      pool,
      request.currentProgress,
      customer,
      {
        candidatePolicy: request.candidatePolicy,
        mode: 'bounded-exhaustive',
      },
    )
    searchedCustomerCount += 1
    rawCandidateCount += result.candidates.length
    exploredLayerCount += result.exploredLayers.length
    truncatedCustomerCount += result.truncated ? 1 : 0
    guaranteedFullMatchCustomerCount +=
      result.guaranteedFullMatchFound ? 1 : 0
  }

  return {
    requestedCustomerCount: request.customerIds.length,
    searchedCustomerCount,
    rawCandidateCount,
    exploredLayerCount,
    truncatedCustomerCount,
    guaranteedFullMatchCustomerCount,
  }
}

function summarizeModel(
  model: ReturnType<typeof buildOptimizationModel>,
): OptimizerModelProfile {
  const eligibleRecipeCounts = new Map(
    model.serviceableCustomerIds.map((customerId) => [customerId, 0]),
  )
  let assignmentEdgeCount = 0

  for (const recipe of model.recipes) {
    assignmentEdgeCount += recipe.eligibleCustomerIds.length
    for (const customerId of recipe.eligibleCustomerIds) {
      eligibleRecipeCounts.set(
        customerId,
        (eligibleRecipeCounts.get(customerId) ?? 0) + 1,
      )
    }
  }

  const counts = [...eligibleRecipeCounts.values()]
  const total = counts.reduce((sum, count) => sum + count, 0)

  return {
    serviceableCustomerCount: model.serviceableCustomerIds.length,
    unresolvedCustomerCount: model.unresolvedCustomerIds.length,
    recipeCount: model.recipes.length,
    assignmentEdgeCount,
    minimumEligibleRecipesPerCustomer:
      counts.length > 0 ? Math.min(...counts) : 0,
    maximumEligibleRecipesPerCustomer:
      counts.length > 0 ? Math.max(...counts) : 0,
    averageEligibleRecipesPerCustomer:
      counts.length > 0 ? total / counts.length : 0,
  }
}

export function profileOptimizerStructure(
  request: OptimizationRequest,
  source?: OptimizationSource,
): OptimizerStructureProfile {
  const totalStartedAt = performance.now()
  const candidatePoolStartedAt = performance.now()
  const pool =
    source?.candidatePool ??
    buildRecipeCandidatePool(request.currentProgress)
  const candidatePoolMs = source?.candidatePool
    ? 0
    : elapsedMs(candidatePoolStartedAt)
  const customers = source?.customers ?? canonicalCustomers

  const rawSearchStartedAt = performance.now()
  const search = profileRawSearch(request, customers, pool)
  const rawSearchMs = elapsedMs(rawSearchStartedAt)

  const modelStartedAt = performance.now()
  const model = buildOptimizationModel(request, {
    ...(source ?? { customers }),
    customers,
    candidatePool: pool,
  })
  const modelBuildMs = elapsedMs(modelStartedAt)

  return {
    candidatePolicy: request.candidatePolicy,
    objective: request.objective,
    candidatePoolEntryCount: pool.entries.length,
    generatedLayerCount: pool.generatedLayers.length,
    generatedCandidateReferenceCount: pool.generatedLayers.reduce(
      (total, layer) => total + layer.candidateIds.length,
      0,
    ),
    generatedSequenceCount: pool.generatedLayers.reduce(
      (total, layer) => total + layer.totalSequenceCount,
      0,
    ),
    truncatedGeneratedLayerCount: pool.generatedLayers.filter(
      (layer) => layer.truncated,
    ).length,
    search,
    model: summarizeModel(model),
    timingsMs: {
      candidatePool: candidatePoolMs,
      rawSearch: rawSearchMs,
      modelBuild: modelBuildMs,
      total: elapsedMs(totalStartedAt),
    },
  }
}

export function profileOptimizerPolicyPair(
  request: Omit<OptimizationRequest, 'candidatePolicy'>,
  source?: OptimizationSource,
): OptimizerPolicyPairProfile {
  const sharedPool =
    source?.candidatePool ??
    buildRecipeCandidatePool(request.currentProgress)
  const sharedSource: OptimizationSource = {
    ...(source ?? { customers: canonicalCustomers }),
    candidatePool: sharedPool,
  }
  const trusted = profileOptimizerStructure(
    { ...request, candidatePolicy: 'trusted-only' },
    sharedSource,
  )
  const computed = profileOptimizerStructure(
    { ...request, candidatePolicy: 'allow-unambiguous-computed' },
    sharedSource,
  )

  return {
    trusted,
    computed,
    deltas: {
      rawCandidateCount:
        computed.search.rawCandidateCount - trusted.search.rawCandidateCount,
      recipeCount:
        computed.model.recipeCount - trusted.model.recipeCount,
      assignmentEdgeCount:
        computed.model.assignmentEdgeCount - trusted.model.assignmentEdgeCount,
      modelBuildMs:
        computed.timingsMs.modelBuild - trusted.timingsMs.modelBuild,
    },
  }
}
