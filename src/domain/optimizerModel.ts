import { customerIsUnlocked, isAvailableAtProgress } from './availability'
import { recipeCandidateMatchesCustomer } from './matching'
import { calculateRecipeIngredientCost } from './recipeCost'
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

export type OptimizationCandidatePolicy =
  | 'observed-only'
  | 'allow-unambiguous-computed'

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
  candidates: RecipeCandidate[]
}

export interface EligibleOptimizationRecipe {
  candidate: RecipeCandidate
  /** Cost for one juice unit, which becomes two sellable servings. */
  juiceUnitIngredientCost: number
  eligibleCustomerIds: string[]
  productionPath: RecipeProductionPath
}

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
  const unmatchedRecipeKinds = new Set(recipeIds).difference(initialRecipeIds).size

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

  const eligibleCandidates = source.candidates.flatMap((candidate) => {
    if (!candidateIsEligible(candidate, request)) return []

    const cost = calculateRecipeIngredientCost(candidate)
    if (cost.batchIngredientCost === null) return []

    // Production eligibility is delegated to the production graph. Multi-base
    // candidates are allowed once they can be expressed as confirmed Blender
    // segment edges; unknown Blender sale/effect rules remain outside this layer.
    const productionPath = productionPathForCandidate(candidate)
    if (!productionPath) return []

    return [{
      candidate,
      juiceUnitIngredientCost: cost.batchIngredientCost,
      productionPath,
    }]
  })

  const unresolvedCustomerIds: string[] = []
  const serviceableCustomerIds: string[] = []
  const eligibleRecipeIdsByCustomer = new Map<string, string[]>()
  const revenueSensitive = requestUsesRevenueCriterion(request)

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

    const recipeIds = eligibleCandidates
      .filter(({ candidate }) => {
        if (!recipeCandidateMatchesCustomer(candidate, customer)) {
          return false
        }

        if (
          revenueSensitive &&
          formalIds.has(customerId) &&
          candidate.salePrice === null
        ) {
          return false
        }

        return true
      })
      .map(({ candidate }) => candidate.id)

    if (recipeIds.length === 0) {
      unresolvedCustomerIds.push(customerId)
      continue
    }

    serviceableCustomerIds.push(customerId)
    eligibleRecipeIdsByCustomer.set(customerId, recipeIds)
  }

  const recipes = eligibleCandidates.flatMap((entry) => {
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
