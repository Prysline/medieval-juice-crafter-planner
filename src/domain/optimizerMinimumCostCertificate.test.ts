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
    expect(domain.recipes).toHaveLength(9255)
    expect(certificate).not.toBeNull()
    expect(certificate?.frontierRecipeCount).toBe(4970)
    expect(certificate?.representativeRecipeCount).toBe(538)

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
