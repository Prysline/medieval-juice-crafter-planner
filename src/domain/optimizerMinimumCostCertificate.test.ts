import { Model, sum } from '@bubblyworld/highs-ts'
import { describe, expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import { buildRecipeCandidatePool } from './recipeCandidatePool'
import {
  buildOptimizationModel,
  type OptimizationRequest,
} from './optimizerModel'
import { prepareMinimumCostStageCertificate } from './optimizerCertificates'

describe('production-scale minimum-cost certificate', () => {
  it('falls back to the generic exact model when initial finished stock changes production cost', () => {
    const domain = buildOptimizationModel(
      {
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
        initialAvailableJuiceJars: [
          { recipeId: 'stocked', servings: 1 },
        ],
      },
      {
        customers: [
          {
            id: 'a',
            name: 'A',
            occupation: '測試',
            villageId: 'east-harbor',
            satisfactionRequired: 0,
            preferences: [{ kind: 'effect', value: '甜味' }],
          },
        ],
        candidates: [
          {
            id: 'stocked',
            name: 'stocked',
            source: 'observed',
            unlockedAt: 'seasoner-unlocked',
            salePrice: 10,
            ingredients: ['檸檬', '糖'],
            effects: [{ name: '甜味', value: 5 }],
            equipment: [],
          },
        ],
      },
    )

    expect(domain.recipes[0]?.initialFinishedServings).toBe(1)
    expect(prepareMinimumCostStageCertificate(domain)).toBeNull()
  })


  it('preserves the exact 604 optimum and reconstructs all 49 serviceable customers', async () => {
    const customerIds = canonicalCustomers.map((customer) => customer.id)
    const request: OptimizationRequest = {
      customerIds,
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
        'ibex-statue': 0,
      },
      formalCustomerIds: customerIds,
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      availableJuiceJarCount: 2,
    }
    const domain = buildOptimizationModel(
      request,
      {
        customers: canonicalCustomers,
        candidatePool: buildRecipeCandidatePool(
          request.currentProgress,
        ),
      },
    )
    const certificate = prepareMinimumCostStageCertificate(domain)

    expect(domain.serviceableCustomerIds).toHaveLength(49)
    expect(certificate).not.toBeNull()

    // Candidate/frontier/representative counts are data-dependent compression
    // statistics. New legitimate observed recipes may change them without
    // changing optimizer correctness, so only lock structural invariants here.
    expect(certificate?.originalRecipeCount).toBe(domain.recipes.length)
    expect(certificate!.frontierRecipeCount).toBeLessThanOrEqual(
      certificate!.originalRecipeCount,
    )
    expect(certificate!.representativeRecipeCount).toBeLessThanOrEqual(
      certificate!.frontierRecipeCount,
    )
    expect(certificate!.continuationDomain.recipes).toHaveLength(
      certificate!.frontierRecipeCount,
    )
    expect(certificate!.stageDomain.recipes).toHaveLength(
      certificate!.representativeRecipeCount,
    )

    const stageDomain = certificate!.stageDomain
    const model = new Model()
    const maxJuiceUnitsPerRecipe = Math.max(
      1,
      Math.ceil(stageDomain.serviceableCustomerIds.length / 2),
    )
    const xByRecipeId = new Map<
      string,
      ReturnType<Model['intVar']>
    >()
    const yByCustomerRecipe = new Map<
      string,
      ReturnType<Model['boolVar']>
    >()

    stageDomain.recipes.forEach((recipe, recipeIndex) => {
      xByRecipeId.set(
        recipe.candidate.id,
        model.intVar(
          0,
          maxJuiceUnitsPerRecipe,
          `x_${recipeIndex}`,
        ),
      )
    })

    stageDomain.serviceableCustomerIds.forEach(
      (customerId, customerIndex) => {
        const assignmentVars: ReturnType<Model['boolVar']>[] = []

        stageDomain.recipes.forEach((recipe, recipeIndex) => {
          if (!recipe.eligibleCustomerIds.includes(customerId)) return

          const y = model.boolVar(
            `y_${customerIndex}_${recipeIndex}`,
          )
          yByCustomerRecipe.set(
            `${customerId}\u001f${recipe.candidate.id}`,
            y,
          )
          assignmentVars.push(y)
        })

        model.addConstraint(
          sum(...assignmentVars).eq(1),
          `customer_${customerIndex}`,
        )
      },
    )

    stageDomain.recipes.forEach((recipe, recipeIndex) => {
      const x = xByRecipeId.get(recipe.candidate.id)
      if (!x) return

      const assignmentVars = recipe.eligibleCustomerIds.flatMap(
        (customerId) => {
          const y = yByCustomerRecipe.get(
            `${customerId}\u001f${recipe.candidate.id}`,
          )
          return y ? [y] : []
        },
      )
      model.addConstraint(
        sum(...assignmentVars).minus(x.times(2)).leq(0),
        `capacity_${recipeIndex}`,
      )
    })

    model.minimize(
      sum(
        ...stageDomain.recipes.flatMap((recipe) => {
          const x = xByRecipeId.get(recipe.candidate.id)
          return x ? [x.times(recipe.juiceUnitIngredientCost)] : []
        }),
      ),
    )

    const solution = await model.solve()

    expect(solution.status).toBe('optimal')
    expect(Math.round(solution.objective ?? Number.NaN)).toBe(604)

    const reconstructedCustomerIds =
      stageDomain.serviceableCustomerIds.filter((customerId) =>
        stageDomain.recipes.some((recipe) => {
          const y = yByCustomerRecipe.get(
            `${customerId}\u001f${recipe.candidate.id}`,
          )
          return y ? (solution.getValue(y) ?? 0) > 0.5 : false
        }),
      )

    expect(reconstructedCustomerIds).toHaveLength(49)
    expect(new Set(reconstructedCustomerIds).size).toBe(49)
  }, 10000)
})
