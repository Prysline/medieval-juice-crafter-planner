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

    const normalizedMachineSignature = (
      recipe: (typeof model.recipes)[number],
      options: {
        preserveSingletonKind: boolean
      },
    ) => {
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

      const sharedTerms: string[] = []
      const singletonTerms: string[] = []

      for (const [edgeKey, multiplicity] of multiplicityByEdgeKey) {
        const usage = stage2EdgeUsage.get(edgeKey)
        if ((usage?.recipeIds.size ?? 0) > 1) {
          sharedTerms.push(`${edgeKey}×${multiplicity}`)
          continue
        }

        singletonTerms.push(
          options.preserveSingletonKind
            ? `${kindByEdgeKey.get(edgeKey)}×${multiplicity}`
            : `${multiplicity}`,
        )
      }

      sharedTerms.sort()
      singletonTerms.sort()

      return [
        recipeServiceMask(recipe).toString(),
        recipe.juiceUnitIngredientCost.toString(),
        sharedTerms.join('\u001d'),
        singletonTerms.join('\u001d'),
      ].join('\u001c')
    }

    const conservativeNormalizedMachineGroups = new Map<
      string,
      (typeof model.recipes)[number][]
    >()
    const totalOnlyNormalizedMachineGroups = new Map<
      string,
      (typeof model.recipes)[number][]
    >()

    for (const recipe of strictCostPrunedRecipes) {
      const conservativeSignature = normalizedMachineSignature(
        recipe,
        { preserveSingletonKind: true },
      )
      const conservativeGroup =
        conservativeNormalizedMachineGroups.get(
          conservativeSignature,
        )
      if (conservativeGroup) {
        conservativeGroup.push(recipe)
      } else {
        conservativeNormalizedMachineGroups.set(
          conservativeSignature,
          [recipe],
        )
      }

      const totalOnlySignature = normalizedMachineSignature(
        recipe,
        { preserveSingletonKind: false },
      )
      const totalOnlyGroup =
        totalOnlyNormalizedMachineGroups.get(totalOnlySignature)
      if (totalOnlyGroup) {
        totalOnlyGroup.push(recipe)
      } else {
        totalOnlyNormalizedMachineGroups.set(
          totalOnlySignature,
          [recipe],
        )
      }
    }

    const normalizedGroupStats = (
      groups: Map<
        string,
        (typeof model.recipes)[number][]
      >,
    ) => {
      const sizes = [...groups.values()]
        .map((group) => group.length)
        .sort((a, b) => b - a)
      return {
        groupCount: groups.size,
        reducibleRecipeCount:
          strictCostPrunedRecipes.length - groups.size,
        assignmentEligibility: [...groups.values()].reduce(
          (total, group) =>
            total + (group[0]?.eligibleCustomerIds.length ?? 0),
          0,
        ),
        largestGroupSizes: sizes.slice(0, 20),
      }
    }

    const conservativeNormalizedMachineStats =
      normalizedGroupStats(conservativeNormalizedMachineGroups)
    const totalOnlyNormalizedMachineStats =
      normalizedGroupStats(totalOnlyNormalizedMachineGroups)

    const sharedKindsSignature = (
      recipe: (typeof model.recipes)[number],
      includedKinds: Set<
        (typeof recipe.productionPath.edges)[number]['kind']
      >,
    ) => {
      const multiplicityByEdgeKey = new Map<string, number>()
      for (const edge of recipe.productionPath.edges) {
        if (!includedKinds.has(edge.kind)) continue
        const usage = stage2EdgeUsage.get(edge.key)
        if ((usage?.recipeIds.size ?? 0) <= 1) continue

        multiplicityByEdgeKey.set(
          edge.key,
          (multiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }

      return [
        recipeServiceMask(recipe).toString(),
        recipe.juiceUnitIngredientCost.toString(),
        [...multiplicityByEdgeKey.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([edgeKey, multiplicity]) => `${edgeKey}×${multiplicity}`)
          .join('\u001d'),
      ].join('\u001c')
    }

    const sharedKindGroupingStats = (
      includedKinds: Set<
        (typeof strictCostPrunedRecipes)[number]['productionPath']['edges'][number]['kind']
      >,
    ) => {
      const groups = new Map<
        string,
        (typeof model.recipes)[number][]
      >()
      for (const recipe of strictCostPrunedRecipes) {
        const signature = sharedKindsSignature(
          recipe,
          includedKinds,
        )
        const group = groups.get(signature)
        if (group) {
          group.push(recipe)
        } else {
          groups.set(signature, [recipe])
        }
      }
      return normalizedGroupStats(groups)
    }

    const stage2SharedJuicingGrouping =
      sharedKindGroupingStats(new Set(['juicing']))
    const stage2SharedJuicingSeasoningGrouping =
      sharedKindGroupingStats(
        new Set(['juicing', 'seasoning']),
      )
    const stage2SharedJuicingSeasoningBlendingGrouping =
      sharedKindGroupingStats(
        new Set(['juicing', 'seasoning', 'blending']),
      )

    const singletonEdgeCountsByRecipe: number[] = []
    const singletonMultiplicityPatterns = new Map<string, number>()
    let recipesWithSingletonEdges = 0
    let recipesWithAllSingletonMultiplicityOne = 0
    let singletonEdgesWithMultiplicityGreaterThanOne = 0
    let localOperationVariableCountByDistinctMultiplicity = 0

    for (const recipe of strictCostPrunedRecipes) {
      const singletonMultiplicityByEdgeKey = new Map<string, number>()

      for (const edge of recipe.productionPath.edges) {
        const usage = stage2EdgeUsage.get(edge.key)
        if ((usage?.recipeIds.size ?? 0) !== 1) continue

        singletonMultiplicityByEdgeKey.set(
          edge.key,
          (singletonMultiplicityByEdgeKey.get(edge.key) ?? 0) + 1,
        )
      }

      const multiplicities = [
        ...singletonMultiplicityByEdgeKey.values(),
      ].sort((a, b) => a - b)

      singletonEdgeCountsByRecipe.push(multiplicities.length)
      if (multiplicities.length > 0) {
        recipesWithSingletonEdges += 1

        const distinctMultiplicities = new Set(multiplicities)
        localOperationVariableCountByDistinctMultiplicity +=
          distinctMultiplicities.size

        if (multiplicities.every((value) => value === 1)) {
          recipesWithAllSingletonMultiplicityOne += 1
        }

        singletonEdgesWithMultiplicityGreaterThanOne +=
          multiplicities.filter((value) => value > 1).length

        const pattern = multiplicities.join(',')
        singletonMultiplicityPatterns.set(
          pattern,
          (singletonMultiplicityPatterns.get(pattern) ?? 0) + 1,
        )
      }
    }

    singletonEdgeCountsByRecipe.sort((a, b) => b - a)
    const singletonMultiplicityPatternCounts = [
      ...singletonMultiplicityPatterns.entries(),
    ]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((left, right) => right.count - left.count)

    const operationVariableCountAfterLocalMultiplicityCompression =
      stage2SharedEdgeCount +
      localOperationVariableCountByDistinctMultiplicity
    const operationVariableReductionFromLocalCompression =
      stage2EdgeUsage.size -
      operationVariableCountAfterLocalMultiplicityCompression
    const projectedStage2VariableCountAfterLocalCompression =
      strictCostPrunedRecipes.length +
      strictCostPrunedAssignmentEligibility +
      operationVariableCountAfterLocalMultiplicityCompression
    const projectedStage2ConstraintCountAfterLocalCompression =
      strictCostPrunedRecipes.length +
      model.serviceableCustomerIds.length +
      operationVariableCountAfterLocalMultiplicityCompression * 2 +
      1

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

    const fixedMinimumCost =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? Math.round(compressedCostStage.objectiveValue)
        : null
    const maxJuiceUnitsPerRecipe = Math.max(
      1,
      Math.ceil(model.serviceableCustomerIds.length / 2),
    )
    const minimumRequiredProductionUnits = Math.ceil(
      model.serviceableCustomerIds.length / 2,
    )
    const strictCostRecipeCosts = strictCostPrunedRecipes.map(
      (recipe) => recipe.juiceUnitIngredientCost,
    )
    const strictCostDistinctCosts = [
      ...new Set(strictCostRecipeCosts),
    ].sort((a, b) => a - b)
    const strictCostNonIntegerCostCount =
      strictCostRecipeCosts.filter(
        (cost) => !Number.isInteger(cost) || cost < 0,
      ).length
    const recipeCountByCost = new Map<number, number>()
    for (const cost of strictCostRecipeCosts) {
      recipeCountByCost.set(
        cost,
        (recipeCountByCost.get(cost) ?? 0) + 1,
      )
    }

    const costFixFeasibleRecipeCosts = new Set<number>()
    const exactCostReachableRecipeCosts = new Set<number>()

    if (
      fixedMinimumCost !== null &&
      strictCostNonIntegerCostCount === 0
    ) {
      for (const selectedCost of strictCostDistinctCosts) {
        if (selectedCost > fixedMinimumCost) continue

        const targetCost = fixedMinimumCost - selectedCost
        const requiredRemainingUnits = Math.max(
          0,
          minimumRequiredProductionUnits - 1,
        )
        const reachable = Array.from(
          { length: targetCost + 1 },
          () =>
            Array.from(
              { length: requiredRemainingUnits + 1 },
              () => false,
            ),
        )
        reachable[0][0] = true

        for (const cost of strictCostDistinctCosts) {
          let availableUnits =
            (recipeCountByCost.get(cost) ?? 0) *
            maxJuiceUnitsPerRecipe
          if (cost === selectedCost) {
            availableUnits -= 1
          }
          if (availableUnits <= 0) continue

          let chunk = 1
          let remaining = availableUnits
          while (remaining > 0) {
            const take = Math.min(chunk, remaining)
            const chunkCost = cost * take
            const chunkUnits = take

            for (
              let currentCost = targetCost - chunkCost;
              currentCost >= 0;
              currentCost -= 1
            ) {
              for (
                let currentUnits = requiredRemainingUnits;
                currentUnits >= 0;
                currentUnits -= 1
              ) {
                if (!reachable[currentCost][currentUnits]) {
                  continue
                }
                const nextCost = currentCost + chunkCost
                const nextUnits = Math.min(
                  requiredRemainingUnits,
                  currentUnits + chunkUnits,
                )
                reachable[nextCost][nextUnits] = true
              }
            }

            remaining -= take
            chunk *= 2
          }
        }

        if (
          reachable[targetCost]?.some((value) => value)
        ) {
          exactCostReachableRecipeCosts.add(selectedCost)
        }
        if (
          reachable[targetCost]?.[requiredRemainingUnits]
        ) {
          costFixFeasibleRecipeCosts.add(selectedCost)
        }
      }
    }

    const recipesRejectedByExactCostFix =
      strictCostPrunedRecipes.filter(
        (recipe) =>
          fixedMinimumCost !== null &&
          !exactCostReachableRecipeCosts.has(
            recipe.juiceUnitIngredientCost,
          ),
      )
    const recipesRejectedByCostFixAndMinimumUnits =
      strictCostPrunedRecipes.filter(
        (recipe) =>
          fixedMinimumCost !== null &&
          !costFixFeasibleRecipeCosts.has(
            recipe.juiceUnitIngredientCost,
          ),
      )
    const recipesRemainingAfterCostFixNecessaryConditions =
      strictCostPrunedRecipes.length -
      recipesRejectedByCostFixAndMinimumUnits.length

    const stage2RecipesByServiceMask = new Map<
      bigint,
      (typeof model.recipes)[number][]
    >()
    for (const recipe of strictCostPrunedRecipes) {
      const mask = recipeServiceMask(recipe)
      const group = stage2RecipesByServiceMask.get(mask)
      if (group) {
        group.push(recipe)
      } else {
        stage2RecipesByServiceMask.set(mask, [recipe])
      }
    }

    let stage2NonUniformCostServiceGroupCount = 0
    for (const group of stage2RecipesByServiceMask.values()) {
      const costs = new Set(
        group.map((recipe) => recipe.juiceUnitIngredientCost),
      )
      if (costs.size !== 1) {
        stage2NonUniformCostServiceGroupCount += 1
      }
    }

    const stage2GroupAssignmentEligibility =
      [...stage2RecipesByServiceMask.values()].reduce(
        (total, group) =>
          total + (group[0]?.eligibleCustomerIds.length ?? 0),
        0,
      )
    const stage2ProjectedVariablesWithGroupAssignments =
      strictCostPrunedRecipes.length +
      stage2GroupAssignmentEligibility +
      stage2EdgeUsage.size
    const stage2ProjectedConstraintsWithGroupAssignments =
      model.serviceableCustomerIds.length +
      stage2RecipesByServiceMask.size +
      stage2EdgeUsage.size * 2 +
      1
    const stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps =
      strictCostPrunedRecipes.length +
      stage2GroupAssignmentEligibility +
      operationVariableCountAfterLocalMultiplicityCompression
    const stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps =
      model.serviceableCustomerIds.length +
      stage2RecipesByServiceMask.size +
      operationVariableCountAfterLocalMultiplicityCompression * 2 +
      1

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
    const localCompressedMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 10.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
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
    const groupedAssignmentMachineHighs =
      compressedCostStage?.status === 'optimal' &&
      compressedCostStage.objectiveValue !== null
        ? await profileHighsOptimization(
            strictCostPrunedModel,
            ['minimum-machine-operations'],
            {
              stageTimeLimitSeconds: 10.5,
              relaxAssignmentVariables: true,
              aggregateLocalSingletonOperations: true,
              aggregateEquivalentAssignments: true,
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
    const localCompressedMachineFirstStage =
      localCompressedMachineHighs?.stages[0]
    const groupedAssignmentMachineFirstStage =
      groupedAssignmentMachineHighs?.stages[0]

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
      stage2ConservativeNormalizedMachineEquivalence:
        conservativeNormalizedMachineStats,
      stage2TotalOnlyNormalizedMachineEquivalence:
        totalOnlyNormalizedMachineStats,
      stage2SharedJuicingGrouping,
      stage2SharedJuicingSeasoningGrouping,
      stage2SharedJuicingSeasoningBlendingGrouping,
      stage2SingletonEdgeCountsByRecipe:
        singletonEdgeCountsByRecipe.slice(0, 20),
      stage2RecipesWithSingletonEdges: recipesWithSingletonEdges,
      stage2RecipesWithAllSingletonMultiplicityOne:
        recipesWithAllSingletonMultiplicityOne,
      stage2SingletonEdgesWithMultiplicityGreaterThanOne:
        singletonEdgesWithMultiplicityGreaterThanOne,
      stage2SingletonMultiplicityPatterns:
        singletonMultiplicityPatternCounts.slice(0, 20),
      stage2LocalOperationVariableCountByDistinctMultiplicity:
        localOperationVariableCountByDistinctMultiplicity,
      stage2OperationVariableCountAfterLocalMultiplicityCompression:
        operationVariableCountAfterLocalMultiplicityCompression,
      stage2OperationVariableReductionFromLocalCompression:
        operationVariableReductionFromLocalCompression,
      stage2ProjectedVariableCountAfterLocalCompression:
        projectedStage2VariableCountAfterLocalCompression,
      stage2ProjectedConstraintCountAfterLocalCompression:
        projectedStage2ConstraintCountAfterLocalCompression,
      stage2FixedMinimumCost: fixedMinimumCost,
      stage2DistinctRecipeCostCount:
        strictCostDistinctCosts.length,
      stage2RecipeCostRange: {
        min: strictCostDistinctCosts.at(0) ?? null,
        max: strictCostDistinctCosts.at(-1) ?? null,
      },
      stage2NonIntegerOrNegativeRecipeCostCount:
        strictCostNonIntegerCostCount,
      stage2ExactCostReachableCostCount:
        exactCostReachableRecipeCosts.size,
      stage2CostFixFeasibleCostCount:
        costFixFeasibleRecipeCosts.size,
      stage2RecipesRejectedByExactCostFix:
        recipesRejectedByExactCostFix.length,
      stage2RecipesRejectedByCostFixAndMinimumUnits:
        recipesRejectedByCostFixAndMinimumUnits.length,
      stage2RecipesRemainingAfterCostFixNecessaryConditions:
        recipesRemainingAfterCostFixNecessaryConditions,
      stage2ServiceGroupCountAfterStrictCostPruning:
        stage2RecipesByServiceMask.size,
      stage2NonUniformCostServiceGroupCount:
        stage2NonUniformCostServiceGroupCount,
      stage2GroupAssignmentEligibility:
        stage2GroupAssignmentEligibility,
      stage2ProjectedVariablesWithGroupAssignments:
        stage2ProjectedVariablesWithGroupAssignments,
      stage2ProjectedConstraintsWithGroupAssignments:
        stage2ProjectedConstraintsWithGroupAssignments,
      stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps:
        stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps,
      stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps:
        stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps,
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
      localCompressedMachineStage:
        localCompressedMachineFirstStage
          ? {
              solveMs: localCompressedMachineFirstStage.solveMs,
              status: localCompressedMachineFirstStage.status,
              objectiveValue:
                localCompressedMachineFirstStage.objectiveValue,
              fixCount:
                localCompressedMachineFirstStage.fixCount,
              variableCount:
                localCompressedMachineFirstStage.variableCount,
              constraintCount:
                localCompressedMachineFirstStage.constraintCount,
              fractionalAssignmentVariableCount:
                localCompressedMachineFirstStage.fractionalAssignmentVariableCount,
              maxAssignmentIntegralityError:
                localCompressedMachineFirstStage.maxAssignmentIntegralityError,
              integralAssignmentReconstructionFeasible:
                localCompressedMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                localCompressedMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                localCompressedMachineHighs?.totalMs ?? 0,
            }
          : null,
      groupedAssignmentMachineStage:
        groupedAssignmentMachineFirstStage
          ? {
              solveMs: groupedAssignmentMachineFirstStage.solveMs,
              status: groupedAssignmentMachineFirstStage.status,
              objectiveValue:
                groupedAssignmentMachineFirstStage.objectiveValue,
              fixCount:
                groupedAssignmentMachineFirstStage.fixCount,
              variableCount:
                groupedAssignmentMachineFirstStage.variableCount,
              constraintCount:
                groupedAssignmentMachineFirstStage.constraintCount,
              fractionalAssignmentVariableCount:
                groupedAssignmentMachineFirstStage.fractionalAssignmentVariableCount,
              maxAssignmentIntegralityError:
                groupedAssignmentMachineFirstStage.maxAssignmentIntegralityError,
              integralAssignmentReconstructionFeasible:
                groupedAssignmentMachineFirstStage.integralAssignmentReconstructionFeasible,
              reconstructedAssignmentCount:
                groupedAssignmentMachineFirstStage.reconstructedAssignmentCount,
              totalMs:
                groupedAssignmentMachineHighs?.totalMs ?? 0,
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
    if (localCompressedMachineFirstStage) {
      expect(localCompressedMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(localCompressedMachineFirstStage.fixCount).toBe(1)
      expect(localCompressedMachineFirstStage.variableCount).toBe(
        projectedStage2VariableCountAfterLocalCompression,
      )
      expect(localCompressedMachineFirstStage.constraintCount).toBe(
        projectedStage2ConstraintCountAfterLocalCompression,
      )
      if (localCompressedMachineFirstStage.objectiveValue !== null) {
        expect(
          localCompressedMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          localCompressedMachineFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
      }
      if (
        expandedMachineFirstStage?.status === 'optimal' &&
        localCompressedMachineFirstStage.status === 'optimal'
      ) {
        expect(
          localCompressedMachineFirstStage.objectiveValue,
        ).toBeCloseTo(
          expandedMachineFirstStage.objectiveValue ?? 0,
          9,
        )
      }
    }
    if (groupedAssignmentMachineFirstStage) {
      expect(groupedAssignmentMachineFirstStage.objective).toBe(
        'machineOperations',
      )
      expect(groupedAssignmentMachineFirstStage.fixCount).toBe(1)
      expect(groupedAssignmentMachineFirstStage.variableCount).toBe(
        stage2ProjectedVariablesWithGroupAssignmentsAndLocalOps,
      )
      expect(groupedAssignmentMachineFirstStage.constraintCount).toBe(
        stage2ProjectedConstraintsWithGroupAssignmentsAndLocalOps,
      )
      if (groupedAssignmentMachineFirstStage.objectiveValue !== null) {
        expect(
          groupedAssignmentMachineFirstStage.integralAssignmentReconstructionFeasible,
        ).toBe(true)
        expect(
          groupedAssignmentMachineFirstStage.reconstructedAssignmentCount,
        ).toBe(model.serviceableCustomerIds.length)
      }
      if (
        localCompressedMachineFirstStage?.status === 'optimal' &&
        groupedAssignmentMachineFirstStage.status === 'optimal'
      ) {
        expect(
          groupedAssignmentMachineFirstStage.objectiveValue,
        ).toBeCloseTo(
          localCompressedMachineFirstStage.objectiveValue ?? 0,
          9,
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
