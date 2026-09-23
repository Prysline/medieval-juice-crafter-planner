import { expect, it } from 'vitest'
import { customers as canonicalCustomers } from '../data/customers'
import {
  buildOptimizationModel,
  normalizedOptimizationPriorities,
  type OptimizationRequest,
} from './optimizerModel'
import {
  buildRecipeCandidatePool,
  recipeCandidatesInCurrentSearchScope,
} from './recipeCandidatePool'
import { calculateRecipeIngredientCost } from './recipeCost'
import { productionPathForCandidate } from './productionPlan'

it(
  'profiles the production-scale Blender computed optimizer workload',
  async () => {
    const request: OptimizationRequest = {
      customerIds: canonicalCustomers.map((customer) => customer.id),
      currentProgress: 'juice-blender-unlocked',
      suppliedCustomerIds: [],
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
      },
      formalCustomerIds: canonicalCustomers.map(
        (customer) => customer.id,
      ),
      candidatePolicy: 'allow-unambiguous-computed',
      objective: 'minimum-cost',
      priorities: [
        'minimum-cost',
        'minimum-machine-operations',
        'minimum-jar-switches',
      ],
      availableJuiceJarCount: 2,
    }

    const candidateGenerationStartedAt = performance.now()
    const candidatePool = buildRecipeCandidatePool(
      request.currentProgress,
    )
    const candidateGenerationMs =
      performance.now() - candidateGenerationStartedAt
    const generatedCurrentCandidates =
      recipeCandidatesInCurrentSearchScope(candidatePool)
    const optimizerBaseEligibleCandidates =
      generatedCurrentCandidates.filter((candidate) => {
        if (candidate.effectAmbiguity) return false
        if (
          calculateRecipeIngredientCost(candidate).batchIngredientCost ===
          null
        ) {
          return false
        }
        return productionPathForCandidate(candidate) !== null
      })
    const knownSalePriceBaseEligibleCandidates =
      optimizerBaseEligibleCandidates.filter(
        (candidate) => candidate.salePrice !== null,
      )

    const modelBuildStartedAt = performance.now()
    const model = buildOptimizationModel(request, {
      customers: canonicalCustomers,
      candidatePool,
    })
    const modelBuildMs = performance.now() - modelBuildStartedAt

    const assignmentEligibilityCount = model.recipes.reduce(
      (total, recipe) => total + recipe.eligibleCustomerIds.length,
      0,
    )

    const eligibleRecipeIdsByCustomer = new Map(
      model.serviceableCustomerIds.map((customerId) => [
        customerId,
        model.recipes
          .filter((recipe) => recipe.eligibleCustomerIds.includes(customerId))
          .map((recipe) => recipe.candidate.id)
          .sort(),
      ]),
    )
    const customerGroupsByEligibility = new Map<
      string,
      string[]
    >()
    for (const customerId of model.serviceableCustomerIds) {
      const signature = (
        eligibleRecipeIdsByCustomer.get(customerId) ?? []
      ).join('\u001e')
      const group = customerGroupsByEligibility.get(signature)
      if (group) {
        group.push(customerId)
      } else {
        customerGroupsByEligibility.set(signature, [customerId])
      }
    }
    const groupedAssignmentVariableUpperBound = [
      ...customerGroupsByEligibility.entries(),
    ].reduce((total, [signature]) => {
      if (!signature) return total
      return total + signature.split('\u001e').length
    }, 0)
    const customerEligibilityGroupSizes = [
      ...customerGroupsByEligibility.values(),
    ]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const productionEdgeCount = new Set(
      model.recipes.flatMap((recipe) =>
        recipe.productionPath.edges.map((edge) => edge.key),
      ),
    ).size

    const customerBitById = new Map(
      model.serviceableCustomerIds.map(
        (customerId, index) => [customerId, 1n << BigInt(index)],
      ),
    )
    const recipeServiceMask = (recipe: (typeof model.recipes)[number]) =>
      recipe.eligibleCustomerIds.reduce(
        (mask, customerId) =>
          mask | (customerBitById.get(customerId) ?? 0n),
        0n,
      )

    const recipesByServiceMask = new Map<
      bigint,
      (typeof model.recipes)[number][]
    >()
    for (const recipe of model.recipes) {
      const mask = recipeServiceMask(recipe)
      const group = recipesByServiceMask.get(mask)
      if (group) {
        group.push(recipe)
      } else {
        recipesByServiceMask.set(mask, [recipe])
      }
    }

    const recipeServiceGroupSizes = [...recipesByServiceMask.values()]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const exactServiceSetCheaperDominatedRecipeIds = new Set<string>()
    for (const group of recipesByServiceMask.values()) {
      const minimumCost = Math.min(
        ...group.map((recipe) => recipe.juiceUnitIngredientCost),
      )
      for (const recipe of group) {
        if (recipe.juiceUnitIngredientCost > minimumCost) {
          exactServiceSetCheaperDominatedRecipeIds.add(
            recipe.candidate.id,
          )
        }
      }
    }

    const serviceGroups = [...recipesByServiceMask.entries()].map(
      ([mask, recipes]) => ({
        mask,
        minimumCost: Math.min(
          ...recipes.map((recipe) => recipe.juiceUnitIngredientCost),
        ),
        recipeIds: recipes.map((recipe) => recipe.candidate.id),
      }),
    )
    const strictlyCheaperSupersetDominatedRecipeIds =
      new Set<string>()
    for (const dominatedGroup of serviceGroups) {
      let cheaperSupersetCost = Infinity

      for (const candidateGroup of serviceGroups) {
        if (
          candidateGroup.minimumCost >= dominatedGroup.minimumCost
        ) {
          continue
        }
        if (
          (candidateGroup.mask & dominatedGroup.mask) !==
          dominatedGroup.mask
        ) {
          continue
        }

        cheaperSupersetCost = Math.min(
          cheaperSupersetCost,
          candidateGroup.minimumCost,
        )
      }

      if (Number.isFinite(cheaperSupersetCost)) {
        for (const recipeId of dominatedGroup.recipeIds) {
          const recipe = model.recipes.find(
            (entry) => entry.candidate.id === recipeId,
          )
          if (
            recipe &&
            recipe.juiceUnitIngredientCost > cheaperSupersetCost
          ) {
            strictlyCheaperSupersetDominatedRecipeIds.add(recipeId)
          }
        }
      }
    }

    const solverImportStartedAt = performance.now()
    const { profileHighsOptimization } = await import(
      './optimizerHighsSolver'
    )
    const solverModuleImportMs =
      performance.now() - solverImportStartedAt

    const priorities = normalizedOptimizationPriorities(request)
    const binaryHighs = await profileHighsOptimization(
      model,
      priorities,
      {
        stageTimeLimitSeconds: 2.5,
        maxStages: 1,
      },
    )
    const relaxedHighs = await profileHighsOptimization(
      model,
      priorities,
      {
        stageTimeLimitSeconds: 10.5,
        relaxAssignmentVariables: true,
        maxStages: 1,
      },
    )
    const binaryFirstStage = binaryHighs.stages[0]
    const relaxedFirstStage = relaxedHighs.stages[0]

    const report = {
      progress: request.currentProgress,
      candidatePolicy: request.candidatePolicy,
      canonicalCustomerCount: canonicalCustomers.length,
      serviceableCustomerCount: model.serviceableCustomerIds.length,
      unresolvedCustomerCount: model.unresolvedCustomerIds.length,
      candidatePoolEntries: candidatePool.entries.length,
      generatedCurrentCandidates: generatedCurrentCandidates.length,
      optimizerBaseEligibleRecipes:
        optimizerBaseEligibleCandidates.length,
      knownSalePriceBaseEligibleRecipes:
        knownSalePriceBaseEligibleCandidates.length,
      customerMatchedOptimizerRecipes: model.recipes.length,
      customerRecipeAssignmentEligibility: assignmentEligibilityCount,
      yVariables: assignmentEligibilityCount,
      customerEligibilityGroupCount: customerGroupsByEligibility.size,
      customerEligibilityGroupSizes,
      groupedAssignmentVariableUpperBound,
      xVariables: model.recipes.length,
      zVariables: model.recipes.length,
      productionEdgeVariables: productionEdgeCount,
      recipeServiceSetCount: recipesByServiceMask.size,
      recipeServiceGroupSizes: recipeServiceGroupSizes.slice(0, 20),
      exactServiceSetCheaperDominatedRecipeCount:
        exactServiceSetCheaperDominatedRecipeIds.size,
      strictlyCheaperSupersetDominatedRecipeCount:
        strictlyCheaperSupersetDominatedRecipeIds.size,
      recipesRemainingAfterStrictCostSupersetDominance:
        model.recipes.length -
        strictlyCheaperSupersetDominatedRecipeIds.size,
      finalHighsVariables: binaryHighs.finalVariableCount,
      finalHighsConstraints: binaryHighs.finalConstraintCount,
      candidateGenerationMs,
      optimizerModelBuildMs: modelBuildMs,
      solverModuleImportMs,
      binaryAssignment: {
        solveMs: binaryFirstStage?.solveMs ?? 0,
        status: binaryFirstStage?.status ?? 'missing',
        objectiveValue: binaryFirstStage?.objectiveValue ?? null,
        variableCount: binaryFirstStage?.variableCount ?? 0,
        constraintCount: binaryFirstStage?.constraintCount ?? 0,
        totalMs: binaryHighs.totalMs,
      },
      relaxedAssignment: {
        solveMs: relaxedFirstStage?.solveMs ?? 0,
        status: relaxedFirstStage?.status ?? 'missing',
        objectiveValue: relaxedFirstStage?.objectiveValue ?? null,
        variableCount: relaxedFirstStage?.variableCount ?? 0,
        constraintCount: relaxedFirstStage?.constraintCount ?? 0,
        fractionalAssignmentVariableCount:
          relaxedFirstStage?.fractionalAssignmentVariableCount ?? 0,
        maxAssignmentIntegralityError:
          relaxedFirstStage?.maxAssignmentIntegralityError ?? 0,
        integralAssignmentReconstructionFeasible:
          relaxedFirstStage?.integralAssignmentReconstructionFeasible ??
          null,
        reconstructedAssignmentCount:
          relaxedFirstStage?.reconstructedAssignmentCount ?? 0,
        totalMs: relaxedHighs.totalMs,
      },
      binaryStages: binaryHighs.stages,
      relaxedStages: relaxedHighs.stages,
    }

    console.info(
      `[Debug-D1 optimizer profile] ${JSON.stringify(report)}`,
    )

    expect(candidatePool.entries.length).toBeGreaterThan(0)
    expect(generatedCurrentCandidates.length).toBeGreaterThan(0)
    expect(model.serviceableCustomerIds.length).toBeGreaterThan(0)
    expect(optimizerBaseEligibleCandidates.length).toBeGreaterThan(0)
    expect(model.recipes.length).toBeGreaterThan(0)
    expect(assignmentEligibilityCount).toBeGreaterThan(0)
    expect(productionEdgeCount).toBeGreaterThan(0)
    expect(binaryHighs.stages).toHaveLength(1)
    expect(relaxedHighs.stages).toHaveLength(1)
    expect(binaryHighs.finalVariableCount).toBeGreaterThan(0)
    expect(binaryHighs.finalConstraintCount).toBeGreaterThan(0)
    expect(relaxedHighs.finalVariableCount).toBe(
      binaryHighs.finalVariableCount,
    )
    expect(relaxedHighs.finalConstraintCount).toBe(
      binaryHighs.finalConstraintCount,
    )
  },
  // The profiler gives each HiGHS stage its own short diagnostic solver
  // limit. This larger test-only timeout lets the stage-build diagnostics
  // finish; production solver semantics and existing smoke-test timeout
  // remain unchanged.
  90_000,
)
