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
    const strictlyCheaperOtherSupersetDominatedRecipeIds =
      new Set<string>()
    const strictCostSupersetDominatedRecipeIds = new Set<string>()
    let nondominatedServiceSetCount = 0

    for (const dominatedGroup of serviceGroups) {
      let bestSupersetCost = Infinity
      let bestOtherSupersetCost = Infinity

      for (const candidateGroup of serviceGroups) {
        if (
          (candidateGroup.mask & dominatedGroup.mask) !==
          dominatedGroup.mask
        ) {
          continue
        }

        bestSupersetCost = Math.min(
          bestSupersetCost,
          candidateGroup.minimumCost,
        )
        if (candidateGroup.mask !== dominatedGroup.mask) {
          bestOtherSupersetCost = Math.min(
            bestOtherSupersetCost,
            candidateGroup.minimumCost,
          )
        }
      }

      if (bestSupersetCost >= dominatedGroup.minimumCost) {
        nondominatedServiceSetCount += 1
      }

      for (const recipeId of dominatedGroup.recipeIds) {
        const recipe = model.recipes.find(
          (entry) => entry.candidate.id === recipeId,
        )
        if (!recipe) continue

        if (recipe.juiceUnitIngredientCost > bestSupersetCost) {
          strictCostSupersetDominatedRecipeIds.add(recipeId)
        }
        if (
          recipe.juiceUnitIngredientCost > bestOtherSupersetCost
        ) {
          strictlyCheaperOtherSupersetDominatedRecipeIds.add(recipeId)
        }
      }
    }

    const strictCostPrunedRecipes = model.recipes.filter(
      (recipe) =>
        !strictCostSupersetDominatedRecipeIds.has(recipe.candidate.id),
    )
    const strictCostPrunedAssignmentEligibility =
      strictCostPrunedRecipes.reduce(
        (total, recipe) => total + recipe.eligibleCustomerIds.length,
        0,
      )
    const strictCostPrunedModel = {
      ...model,
      recipes: strictCostPrunedRecipes,
    }

    const representativeByServiceMask = new Map<
      bigint,
      (typeof model.recipes)[number]
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const mask = recipeServiceMask(recipe)
      const current = representativeByServiceMask.get(mask)
      if (
        !current ||
        recipe.juiceUnitIngredientCost <
          current.juiceUnitIngredientCost
      ) {
        representativeByServiceMask.set(mask, recipe)
      }
    }
    const costStageCompressedRecipes = [
      ...representativeByServiceMask.values(),
    ]
    const costStageCompressedAssignmentEligibility =
      costStageCompressedRecipes.reduce(
        (total, recipe) => total + recipe.eligibleCustomerIds.length,
        0,
      )
    const costStageCompressedModel = {
      ...model,
      recipes: costStageCompressedRecipes,
    }

    const productionEdgeMultiplicitySignature = (
      recipe: (typeof model.recipes)[number],
    ) => {
      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }
      return [...multiplicityByEdgeKey.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([edgeKey, multiplicity]) => `${edgeKey}×${multiplicity}`)
        .join('\u001d')
    }

    const machineEquivalenceGroups = new Map<
      string,
      (typeof model.recipes)[number][]
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const signature = [
        recipeServiceMask(recipe).toString(),
        recipe.juiceUnitIngredientCost.toString(),
        productionEdgeMultiplicitySignature(recipe),
      ].join('\u001c')
      const group = machineEquivalenceGroups.get(signature)
      if (group) {
        group.push(recipe)
      } else {
        machineEquivalenceGroups.set(signature, [recipe])
      }
    }
    const machineEquivalenceGroupSizes = [
      ...machineEquivalenceGroups.values(),
    ]
      .map((group) => group.length)
      .sort((a, b) => b - a)
    const machineEquivalenceReducibleRecipeCount =
      strictCostPrunedRecipes.length - machineEquivalenceGroups.size
    const machineEquivalenceAssignmentEligibility =
      [...machineEquivalenceGroups.values()].reduce(
        (total, group) =>
          total + (group[0]?.eligibleCustomerIds.length ?? 0),
        0,
      )

    const stage2EdgeUsage = new Map<
      string,
      {
        kind:
          (typeof strictCostPrunedRecipes)[number]['productionPath']['edges'][number]['kind']
        recipeIds: Set<string>
        totalMultiplicity: number
      }
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const multiplicityByEdgeKey = new Map<string, number>()
      const kindByEdgeKey = new Map<
        string,
        (typeof recipe.productionPath.edges)[number]['kind']
      >()
      for (const edge of recipe.productionPath.edges) {
        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
        kindByEdgeKey.set(edge.key, edge.kind)
      }

      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const current = stage2EdgeUsage.get(edgeKey) ?? {
          kind: kindByEdgeKey.get(edgeKey)!,
          recipeIds: new Set<string>(),
          totalMultiplicity: 0,
        }
        current.recipeIds.add(recipe.candidate.id)
        current.totalMultiplicity += multiplicity
        stage2EdgeUsage.set(edgeKey, current)
      }
    }

    const edgeKindStats = {
      juicing: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
      seasoning: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
      blending: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
      finalizing: { uniqueEdges: 0, singletonEdges: 0, recipeIncidences: 0 },
    }
    const edgeRecipeUsageCounts: number[] = []
    for (const usage of stage2EdgeUsage.values()) {
      const recipeCount = usage.recipeIds.size
      edgeRecipeUsageCounts.push(recipeCount)
      const stats = edgeKindStats[usage.kind]
      stats.uniqueEdges += 1
      stats.recipeIncidences += recipeCount
      if (recipeCount === 1) {
        stats.singletonEdges += 1
      }
    }
    edgeRecipeUsageCounts.sort((a, b) => b - a)
    const stage2SingletonEdgeCount = edgeRecipeUsageCounts.filter(
      (count) => count === 1,
    ).length
    const stage2SharedEdgeCount =
      edgeRecipeUsageCounts.length - stage2SingletonEdgeCount

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
    const prunedRelaxedHighs = await profileHighsOptimization(
      strictCostPrunedModel,
      priorities,
      {
        stageTimeLimitSeconds: 10.5,
        relaxAssignmentVariables: true,
        maxStages: 1,
      },
    )
    const compressedRelaxedHighs = await profileHighsOptimization(
      costStageCompressedModel,
      priorities,
      {
        stageTimeLimitSeconds: 10.5,
        relaxAssignmentVariables: true,
        maxStages: 1,
      },
    )
    const compressedCostStage = compressedRelaxedHighs.stages[0]
    const expandedMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 10.5,
              relaxAssignmentVariables: true,
              maxStages: 1,
              initialCriterionFixes: [
                {
                  criterion: 'minimum-cost',
                  value: Math.round(
                    compressedCostStage.objectiveValue,
                  ),
                },
              ],
            },
          )
        : null
    const binaryFirstStage = binaryHighs.stages[0]
    const relaxedFirstStage = relaxedHighs.stages[0]
    const prunedRelaxedFirstStage = prunedRelaxedHighs.stages[0]
    const compressedRelaxedFirstStage =
      compressedRelaxedHighs.stages[0]
    const expandedMachineFirstStage =
      expandedMachineHighs?.stages[0]

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
      strictlyCheaperOtherSupersetDominatedRecipeCount:
        strictlyCheaperOtherSupersetDominatedRecipeIds.size,
      strictCostSupersetDominatedRecipeCount:
        strictCostSupersetDominatedRecipeIds.size,
      nondominatedServiceSetCount,
      recipesRemainingAfterStrictCostSupersetDominance:
        strictCostPrunedRecipes.length,
      assignmentEligibilityRemainingAfterStrictCostSupersetDominance:
        strictCostPrunedAssignmentEligibility,
      costStageCompressedRecipeCount:
        costStageCompressedRecipes.length,
      costStageCompressedAssignmentEligibility:
        costStageCompressedAssignmentEligibility,
      stage2MachineEquivalenceGroupCount:
        machineEquivalenceGroups.size,
      stage2MachineEquivalenceGroupSizes:
        machineEquivalenceGroupSizes.slice(0, 20),
      stage2MachineEquivalenceReducibleRecipeCount:
        machineEquivalenceReducibleRecipeCount,
      stage2MachineEquivalenceAssignmentEligibility:
        machineEquivalenceAssignmentEligibility,
      stage2UniqueProductionEdgeCount: stage2EdgeUsage.size,
      stage2SingletonProductionEdgeCount:
        stage2SingletonEdgeCount,
      stage2SharedProductionEdgeCount:
        stage2SharedEdgeCount,
      stage2TopProductionEdgeRecipeUsageCounts:
        edgeRecipeUsageCounts.slice(0, 20),
      stage2ProductionEdgeKindStats: edgeKindStats,
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
      prunedRelaxedAssignment: {
        solveMs: prunedRelaxedFirstStage?.solveMs ?? 0,
        status: prunedRelaxedFirstStage?.status ?? 'missing',
        objectiveValue: prunedRelaxedFirstStage?.objectiveValue ?? null,
        variableCount: prunedRelaxedFirstStage?.variableCount ?? 0,
        constraintCount: prunedRelaxedFirstStage?.constraintCount ?? 0,
        fractionalAssignmentVariableCount:
          prunedRelaxedFirstStage?.fractionalAssignmentVariableCount ?? 0,
        maxAssignmentIntegralityError:
          prunedRelaxedFirstStage?.maxAssignmentIntegralityError ?? 0,
        integralAssignmentReconstructionFeasible:
          prunedRelaxedFirstStage?.integralAssignmentReconstructionFeasible ??
          null,
        reconstructedAssignmentCount:
          prunedRelaxedFirstStage?.reconstructedAssignmentCount ?? 0,
        totalMs: prunedRelaxedHighs.totalMs,
      },
      compressedRelaxedAssignment: {
        solveMs: compressedRelaxedFirstStage?.solveMs ?? 0,
        status: compressedRelaxedFirstStage?.status ?? 'missing',
        objectiveValue:
          compressedRelaxedFirstStage?.objectiveValue ?? null,
        variableCount:
          compressedRelaxedFirstStage?.variableCount ?? 0,
        constraintCount:
          compressedRelaxedFirstStage?.constraintCount ?? 0,
        fractionalAssignmentVariableCount:
          compressedRelaxedFirstStage?.fractionalAssignmentVariableCount ??
          0,
        maxAssignmentIntegralityError:
          compressedRelaxedFirstStage?.maxAssignmentIntegralityError ?? 0,
        integralAssignmentReconstructionFeasible:
          compressedRelaxedFirstStage?.integralAssignmentReconstructionFeasible ??
          null,
        reconstructedAssignmentCount:
          compressedRelaxedFirstStage?.reconstructedAssignmentCount ?? 0,
        totalMs: compressedRelaxedHighs.totalMs,
      },
      expandedMachineStage: expandedMachineFirstStage
        ? {
            solveMs: expandedMachineFirstStage.solveMs,
            status: expandedMachineFirstStage.status,
            objectiveValue:
              expandedMachineFirstStage.objectiveValue,
            fixCount: expandedMachineFirstStage.fixCount,
            variableCount: expandedMachineFirstStage.variableCount,
            constraintCount:
              expandedMachineFirstStage.constraintCount,
            fractionalAssignmentVariableCount:
              expandedMachineFirstStage.fractionalAssignmentVariableCount,
            maxAssignmentIntegralityError:
              expandedMachineFirstStage.maxAssignmentIntegralityError,
            integralAssignmentReconstructionFeasible:
              expandedMachineFirstStage.integralAssignmentReconstructionFeasible,
            reconstructedAssignmentCount:
              expandedMachineFirstStage.reconstructedAssignmentCount,
            totalMs: expandedMachineHighs?.totalMs ?? 0,
          }
        : null,
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
    expect(prunedRelaxedHighs.stages).toHaveLength(1)
    expect(compressedRelaxedHighs.stages).toHaveLength(1)
    expect(strictCostPrunedRecipes.length).toBeGreaterThan(0)
    expect(strictCostPrunedRecipes.length).toBeLessThan(model.recipes.length)
    expect(costStageCompressedRecipes.length).toBeGreaterThan(0)
    expect(costStageCompressedRecipes.length).toBeLessThan(
      strictCostPrunedRecipes.length,
    )
    if (
      relaxedFirstStage?.status === 'optimal' &&
      prunedRelaxedFirstStage?.status === 'optimal'
    ) {
      expect(prunedRelaxedFirstStage.objectiveValue).toBeCloseTo(
        relaxedFirstStage.objectiveValue ?? 0,
        9,
      )
    }
    if (
      prunedRelaxedFirstStage?.status === 'optimal' &&
      compressedRelaxedFirstStage?.status === 'optimal'
    ) {
      expect(compressedRelaxedFirstStage.objectiveValue).toBeCloseTo(
        prunedRelaxedFirstStage.objectiveValue ?? 0,
        9,
      )
    }
    if (expandedMachineFirstStage) {
      expect(expandedMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(expandedMachineFirstStage.fixCount).toBe(1)
      if (expandedMachineFirstStage.objectiveValue !== null) {
        expect(
          expandedMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(expandedMachineFirstStage.reconstructedAssignmentCount).toBe(
          model.serviceableCustomerIds.length,
        )
      }
    }
  },
  // The profiler gives each HiGHS stage its own short diagnostic solver
  // limit. This larger test-only timeout lets the stage-build diagnostics
  // finish; production solver semantics and existing smoke-test timeout
  // remain unchanged.
  90_000,
)
