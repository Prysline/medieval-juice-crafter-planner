import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import type { OptimizationObjective, OptimizationRequest } from './optimizerModel'
import { profileOptimizerPolicyPair } from './optimizerPerformanceProfile'

const runProfile = process.env.OPTIMIZER_PERF_PROFILE === '1'

const baseRequest: Omit<OptimizationRequest, 'candidatePolicy' | 'objective'> = {
  customerIds: customers.map((customer) => customer.id),
  currentProgress: 'liquid-blender-unlocked',
  suppliedCustomerIds: [],
  satisfactionByVillage: {
    'east-harbor': 9999,
    'tranquil-fountain': 9999,
    'ibex-statue': 9999,
  },
  formalCustomerIds: customers.map((customer) => customer.id),
}

const objectives: OptimizationObjective[] = [
  'minimum-cost',
  'minimum-waste',
  'maximum-ingredient-cost',
  'maximum-known-gross-profit',
]

describe.skipIf(!runProfile)('computed optimizer paired structural baseline', () => {
  for (const objective of objectives) {
    it(
      `profiles trusted-only vs computed-enabled for ${objective}`,
      () => {
        const profile = profileOptimizerPolicyPair({
          ...baseRequest,
          objective,
        })

        console.log(
          `OPTIMIZER_PERF_PROFILE ${objective} ${JSON.stringify(profile)}`,
        )

        expect(profile.trusted.candidatePolicy).toBe('trusted-only')
        expect(profile.computed.candidatePolicy).toBe(
          'allow-unambiguous-computed',
        )
        expect(profile.computed.search.rawCandidateCount).toBeGreaterThanOrEqual(
          profile.trusted.search.rawCandidateCount,
        )
        expect(profile.computed.model.recipeCount).toBeGreaterThanOrEqual(
          profile.trusted.model.recipeCount,
        )
        expect(profile.computed.model.assignmentEdgeCount).toBeGreaterThanOrEqual(
          profile.trusted.model.assignmentEdgeCount,
        )
        expect(profile.trusted.model.assignmentEdgeCount).toBe(
          Math.round(
            profile.trusted.model.averageEligibleRecipesPerCustomer *
              profile.trusted.model.serviceableCustomerCount,
          ),
        )
        expect(profile.computed.model.assignmentEdgeCount).toBe(
          Math.round(
            profile.computed.model.averageEligibleRecipesPerCustomer *
              profile.computed.model.serviceableCustomerCount,
          ),
        )
      },
      120_000,
    )
  }
})
