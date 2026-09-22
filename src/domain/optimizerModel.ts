import { customerIsUnlocked, isAvailableAtProgress } from './availability'
import { recipeCandidateMatchesCustomer } from './matching'
import { calculateRecipeIngredientCost } from './recipeCost'
import type { RecipeCandidatePool } from './recipeCandidatePool'
import {
  searchRecipeCandidatesForCustomer,
  type ProgressiveRecipeSearchPolicy,
} from './recipeSearch'
import {
  productionPathForCandidate,
  type RecipeProductionPath,
} from './productionPlan'
import type {
  Customer,
  ProgressMilestoneId,
  RecipeCandidate,
  SatisfactionByVillage,
} from '../types'

export type OptimizationCandidatePolicy = ProgressiveRecipeSearchPolicy

export type OptimizationObjective =
  | 'minimum-cost'
  | 'minimum-waste'
  | 'maximum-known-revenue'
  | 'maximum-known-gross-profit'

export type OptimizationCriterion =
  | OptimizationObjective
  | 'minimum-machine-operations'
  | 'minimum-jar-switches'

export interface OptimizationConstraints {
  maxJarTypeSwitches?: number
}

export interface OptimizationCarriedJuiceJarState {
  recipeId: string | null
  servings: number
}

export interface OptimizationRequest {
  customerIds: string[]
  currentProgress: ProgressMilestoneId
  suppliedCustomerIds: string[]
  satisfactionByVillage: SatisfactionByVillage
  formalCustomerIds: string[]
  candidatePolicy: OptimizationCandidatePolicy
  /** Primary objective kept for compatibility with saved/UI state. */
  objective: OptimizationObjective
  /** Ordered lexicographic criteria. Defaults to [objective]. */
  priorities?: OptimizationCriterion[]
  constraints?: OptimizationConstraints
  /** Legacy empty-jar summary used when initialCarriedJuiceJars is omitted. */
  availableJuiceJarCount?: number
  /**
   * Minimal container summary used only by jar-switch criteria/constraints.
   * This is not a packing or route model.
   */
  initialCarriedJuiceJars?: OptimizationCarriedJuiceJarState[]
}

export interface OptimizationSource {
  customers: Customer[]
  /**
   * Flat candidates remain supported for focused unit tests and explicit callers.
   * Runtime Candidate-2A uses candidatePool so every customer shares the same
   * progressive search contract.
   */
  candidates?: readonly RecipeCandidate[]
  candidatePool?: RecipeCandidatePool
}

export interface EligibleOptimizationRecipe {
  candidate: RecipeCandidate
  /** Cost for one juice unit, which becomes two sellable servings. */
  juiceUnitIngredientCost: number
  eligibleCustomerIds: string[]
  productionPath: RecipeProductionPath
}

type EligibleOptimizationRecipeCore = Omit<
  EligibleOptimizationRecipe,
  'eligibleCustomerIds'
>

export interface BatchOptimizationModel {
  request: OptimizationRequest
  serviceableCustomerIds: string[]
  unresolvedCustomerIds: string[]
  excludedSuppliedCustomerIds: string[]
  recipes: EligibleOptimizationRecipe[]
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function normalizedOptimizationPriorities(
  request: OptimizationRequest,
): OptimizationCriterion[] {
  const requested =
    request.priorities && request.priorities.length > 0
      ? request.priorities
      : [request.objective]

  return unique(requested) as OptimizationCriterion[]
}

export function normalizedInitialCarriedJuiceJars(
  request: OptimizationRequest,
): OptimizationCarriedJuiceJarState[] {
  if (
    request.initialCarriedJuiceJars &&
    request.initialCarriedJuiceJars.length > 0
  ) {
    return request.initialCarriedJuiceJars.map((jar) => {
      const servings =
        typeof jar.servings === 'number' && Number.isFinite(jar.servings)
          ? Math.max(0, Math.floor(jar.servings))
          : 0

      return {
        recipeId:
          servings > 0 && typeof jar.recipeId === 'string' && jar.recipeId
            ? jar.recipeId
            : null,
        servings,
      }
    })
  }

  const value = request.availableJuiceJarCount
  const count =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.floor(value))
      : 1

  return Array.from({ length: count }, () => ({
    recipeId: null,
    servings: 0,
  }))
}

export function normalizedAvailableJuiceJarCount(
  request: OptimizationRequest,
): number {
  return normalizedInitialCarriedJuiceJars(request).length
}

export function minimumJarTypeSwitchesForRecipeIds(
  request: OptimizationRequest,
  recipeIds: string[],
): number {
  const jars = normalizedInitialCarriedJuiceJars(request)
  const initialRecipeIds = new Set(
    jars.flatMap((jar) => (jar.recipeId && jar.servings > 0 ? [jar.recipeId] : [])),
  )
  const emptyJarCount = jars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  const unmatchedRecipeKinds = [...new Set(recipeIds)].filter(
    (recipeId) => !initialRecipeIds.has(recipeId),
  ).length

  return Math.max(0, unmatchedRecipeKinds - emptyJarCount)
}

export function isRevenueCriterion(
  criterion: OptimizationCriterion,
): boolean {
  return (
    criterion === 'maximum-known-revenue' ||
    criterion === 'maximum-known-gross-profit'
  )
}

export function requestUsesRevenueCriterion(
  request: OptimizationRequest,
): boolean {
  return normalizedOptimizationPriorities(request).some(isRevenueCriterion)
}

function candidateIsEligible(
  candidate: RecipeCandidate,
  request: OptimizationRequest,
): boolean {
  if (candidate.effectAmbiguity) return false
  if (
    request.candidatePolicy === 'observed-only' &&
    candidate.source !== 'observed'
  ) {
    return false
  }

  return isAvailableAtProgress(
    candidate.unlockedAt,
    request.currentProgress,
  )
}

function eligibleOptimizationRecipe(
  candidate: RecipeCandidate,
  request: OptimizationRequest,
): EligibleOptimizationRecipeCore | null {
  if (!candidateIsEligible(candidate, request)) return null

  const cost = calculateRecipeIngredientCost(candidate)
  if (cost.batchIngredientCost === null) return null

  // Production eligibility remains owned by the production graph. Candidate-2A
  // only generates one juice segment; explicit multi-base fixtures still use
  // the already-confirmed Blender production path support.
  const productionPath = productionPathForCandidate(candidate)
  if (!productionPath) return null

  return {
    candidate,
    juiceUnitIngredientCost: cost.batchIngredientCost,
    productionPath,
  }
}

export function buildOptimizationModel(
  request: OptimizationRequest,
  source: OptimizationSource,
): BatchOptimizationModel {
  const suppliedIds = new Set(request.suppliedCustomerIds)
  const formalIds = new Set(request.formalCustomerIds)
  const requestedIds = unique(request.customerIds)
  const excludedSuppliedCustomerIds = requestedIds.filter((id) =>
    suppliedIds.has(id),
  )
  const demandIds = requestedIds.filter((id) => !suppliedIds.has(id))
  const customerById = new Map(
    source.customers.map((customer) => [customer.id, customer]),
  )
  const revenueSensitive = requestUsesRevenueCriterion(request)
  const eligibleEntryCache = new Map<
    string,
    EligibleOptimizationRecipeCore | null
  >()
  const selectedEntriesById = new Map<
    string,
    EligibleOptimizationRecipeCore
  >()

  function cachedEligibleEntry(
    candidate: RecipeCandidate,
  ): EligibleOptimizationRecipeCore | null {
    if (eligibleEntryCache.has(candidate.id)) {
      return eligibleEntryCache.get(candidate.id) ?? null
    }
    const entry = eligibleOptimizationRecipe(candidate, request)
    eligibleEntryCache.set(candidate.id, entry)
    return entry
  }

  const unresolvedCustomerIds: string[] = []
  const serviceableCustomerIds: string[] = []
  const eligibleRecipeIdsByCustomer = new Map<string, string[]>()

  for (const customerId of demandIds) {
    const customer = customerById.get(customerId)
    if (
      !customer ||
      !customerIsUnlocked(
        customer,
        request.currentProgress,
        request.satisfactionByVillage,
      )
    ) {
      unresolvedCustomerIds.push(customerId)
      continue
    }

    const candidateSource = source.candidatePool
      ? searchRecipeCandidatesForCustomer(
          source.candidatePool,
          request.currentProgress,
          customer,
          {
            candidatePolicy: request.candidatePolicy,
            additionalCandidateEligibility: (candidate) => {
              if (!cachedEligibleEntry(candidate)) return false
              if (
                revenueSensitive &&
                formalIds.has(customerId) &&
                candidate.salePrice === null
              ) {
                return false
              }
              return true
            },
          },
        ).candidates
      : (source.candidates ?? [])

    const recipeIds: string[] = []
    for (const candidate of candidateSource) {
      const entry = cachedEligibleEntry(candidate)
      if (!entry) continue
      if (!recipeCandidateMatchesCustomer(candidate, customer)) {
        continue
      }
      if (
        revenueSensitive &&
        formalIds.has(customerId) &&
        candidate.salePrice === null
      ) {
        continue
      }

      recipeIds.push(candidate.id)
      if (!selectedEntriesById.has(candidate.id)) {
        selectedEntriesById.set(candidate.id, entry)
      }
    }

    if (recipeIds.length === 0) {
      unresolvedCustomerIds.push(customerId)
      continue
    }

    serviceableCustomerIds.push(customerId)
    eligibleRecipeIdsByCustomer.set(customerId, recipeIds)
  }

  const recipes = [...selectedEntriesById.values()].flatMap((entry) => {
    const eligibleCustomerIds = serviceableCustomerIds.filter((customerId) =>
      eligibleRecipeIdsByCustomer.get(customerId)?.includes(entry.candidate.id),
    )

    return eligibleCustomerIds.length > 0
      ? [{
          ...entry,
          eligibleCustomerIds,
        }]
      : []
  })

  return {
    request,
    serviceableCustomerIds,
    unresolvedCustomerIds,
    excludedSuppliedCustomerIds,
    recipes,
  }
}
