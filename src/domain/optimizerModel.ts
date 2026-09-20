import { customerIsUnlocked, isAvailableAtProgress } from './availability'
import { recipeCandidateMatchesCustomer } from './matching'
import { calculateRecipeIngredientCost } from './recipeCost'
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

export interface OptimizationRequest {
  customerIds: string[]
  currentProgress: ProgressMilestoneId
  suppliedCustomerIds: string[]
  satisfactionByVillage: SatisfactionByVillage
  candidatePolicy: OptimizationCandidatePolicy
  objective: OptimizationObjective
}

export interface OptimizationSource {
  customers: Customer[]
  candidates: RecipeCandidate[]
}

export interface EligibleOptimizationRecipe {
  candidate: RecipeCandidate
  batchIngredientCost: number
  eligibleCustomerIds: string[]
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

    return [{
      candidate,
      batchIngredientCost: cost.batchIngredientCost,
    }]
  })

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

    const recipeIds = eligibleCandidates
      .filter(({ candidate }) =>
        recipeCandidateMatchesCustomer(candidate, customer),
      )
      .map(({ candidate }) => candidate.id)

    if (recipeIds.length === 0) {
      unresolvedCustomerIds.push(customerId)
      continue
    }

    serviceableCustomerIds.push(customerId)
    eligibleRecipeIdsByCustomer.set(customerId, recipeIds)
  }

  const serviceableSet = new Set(serviceableCustomerIds)
  const recipes = eligibleCandidates.flatMap((entry) => {
    const eligibleCustomerIds = serviceableCustomerIds.filter((customerId) =>
      eligibleRecipeIdsByCustomer.get(customerId)?.includes(entry.candidate.id),
    )

    return eligibleCustomerIds.length > 0
      ? [{
          ...entry,
          eligibleCustomerIds: eligibleCustomerIds.filter((id) =>
            serviceableSet.has(id),
          ),
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
