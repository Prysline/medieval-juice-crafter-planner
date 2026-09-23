import { customerIsUnlocked, isAvailableAtProgress } from './availability'
import { minimumJarTypeSwitchesForInitialJars } from './jarSwitches'
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
  | 'maximum-ingredient-cost'
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
  /** Legacy empty-jar summary used when no initial jar-state list is supplied. */
  availableJuiceJarCount?: number
  /**
   * Minimal state for every physical juice jar that the day planner may use.
   * With a jar rack, these jars may be swapped between trips; this is not a
   * packing or route model.
   */
  initialAvailableJuiceJars?: OptimizationCarriedJuiceJarState[]
  /** Legacy alias retained for saved/tests callers during migration. */
  initialCarriedJuiceJars?: OptimizationCarriedJuiceJarState[]
}

export interface OptimizationSource {
  customers: Customer[]
  /**
   * 保留 flat candidates 給聚焦單元測試與明確指定來源的 caller。
   * Candidate-2A runtime 使用 candidatePool，讓每位顧客共用同一套
   * progressive search contract。
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
  const suppliedJars =
    request.initialAvailableJuiceJars &&
    request.initialAvailableJuiceJars.length > 0
      ? request.initialAvailableJuiceJars
      : request.initialCarriedJuiceJars

  if (suppliedJars && suppliedJars.length > 0) {
    return suppliedJars.map((jar) => {
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
  return minimumJarTypeSwitchesForInitialJars(
    normalizedInitialCarriedJuiceJars(request),
    recipeIds,
  )
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

  // 製作可行性仍由 production graph 負責。Candidate-2B 的共用搜尋可產生
  // canonical multi-segment candidates，但不另外實作第二套 Blender execution 規則。
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
  const eligibleCustomerIdsByRecipe = new Map<string, string[]>()

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
            mode: 'bounded-exhaustive',
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
    for (const recipeId of new Set(recipeIds)) {
      const eligibleCustomerIds =
        eligibleCustomerIdsByRecipe.get(recipeId)
      if (eligibleCustomerIds) {
        eligibleCustomerIds.push(customerId)
      } else {
        eligibleCustomerIdsByRecipe.set(recipeId, [customerId])
      }
    }
  }

  const recipes = [...selectedEntriesById.values()].flatMap((entry) => {
    const eligibleCustomerIds =
      eligibleCustomerIdsByRecipe.get(entry.candidate.id) ?? []

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
